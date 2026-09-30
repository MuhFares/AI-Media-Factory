/**
 * CEOAgent — executive decision layer.
 *
 * Dual-mode:
 *  - Deterministic decide(): produces validated ExecutiveDirective for Orchestrator
 *    via workflow templates (legacy path, retained for compatibility and decision-layer isolation).
 *  - LLM synthesize (PRE_PUBLICATION strategy council): synthesizes the 7 specialist
 *    reports (research, planner, writer, seo, brand, growth, finance) via LLM
 *    (glm-5.3 via AgentRouter OPENAI_COMPATIBLE) into a grounded ExecutiveDirective.
 *    Uses the same LLM pattern as writer-agent: system prompt, ExecutionRequest
 *    with model, messages, responseSchema, runExecution via injected execute
 *    dependency, and JSON parsing.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionRequest, ExecutionResponse } from "@ai-media-factory/runtime";
import type { AgentExecutionInput, AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  CEOAgentOptions,
  DecisionEvidence,
  ExecutiveDirective,
  ExecutiveObjectiveInput,
  Priority,
  WorkflowIntent,
  StrategyCouncilSynthesisV2,
} from "./types.js";
import { STRATEGY_COUNCIL_V2_EXAMPLE, STRATEGY_COUNCIL_V2_OUTPUT_INSTRUCTIONS, STRATEGY_COUNCIL_V2_RESPONSE_SCHEMA, STRATEGY_COUNCIL_V2_SYSTEM_PROMPT, validateStrategyCouncilSynthesisV2, validateStrategyCouncilV2Manifest } from "./strategy-council-v2.js";
import {
  assertAgentsAvailable,
  isWorkflowIntent,
  normalizeConstraints,
  templateAgentsFor,
  validateObjective,
  validatePriority,
} from "./policy.js";

/** Default CEO LLM system prompt for strategy council synthesis. */
export const DEFAULT_CEO_SYSTEM_PROMPT = `You are the CEO strategy agent for the business strategy council (PRE_PUBLICATION).

You must:
1. Synthesize ONLY the 7 supplied specialist reports: research, planner, writer, SEO, brand, growth, and finance.
2. Produce a grounded ExecutiveDirective that references only figures, content ids, and evidence present in those reports.
3. Never invent or hallucinate metrics, revenue, ROI, or source artifact ids that were not supplied.
4. Derive objective, priority, workflow intent, success criteria, and rationale strictly from the validated specialist evidence.
5. Include sourceArtifactReferences that map exactly to the supplied specialist artifact ids.
6. If any specialist report is missing, malformed, or the evidence is insufficient, return a directive with priority "medium" and rationale describing the gap — do not fabricate.
7. Output a valid JSON ExecutiveDirective. Do not include explanatory text outside the JSON.`;

const DEFAULT_SOURCE = "executive-registered-policy";
const BUSINESS_SOURCE = "business-strategy-council-policy";

function hashPart(content: string, salt: number): string {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Deterministic, content-derived identifier (stable for identical input). */
export function deriveId(content: string): string {
  return [0, 1, 2, 3].map((salt) => hashPart(content, salt)).join("-");
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isJsonRecord(value: Json): value is { [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface CEOConfig {
  model: string;
  systemPrompt: string;
  temperature: number;
  maxOutputTokens: number;
  includeReasoning?: boolean;
}

export interface CEODependencies extends CEOAgentOptions {
  execute?: (context: ExecutionContext, request: ExecutionRequest, signal: CancellationToken) => Promise<ExecutionResponse>;
  config?: CEOConfig;
}

export class CEOAgent {
  readonly id: AgentId = "ceo";
  readonly name = "CEO Agent";
  readonly version = "1.0.0";

  private readonly registry;
  private readonly clock;
  private readonly decisionSource;
  private readonly ceoConfig: CEOConfig;
  private readonly executeFn?: (context: ExecutionContext, request: ExecutionRequest, signal: CancellationToken) => Promise<ExecutionResponse>;

  constructor(options: CEODependencies = {}) {
    this.registry = options.registry;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.decisionSource = options.decisionSource ?? DEFAULT_SOURCE;
    this.ceoConfig = {
      model: options.config?.model ?? "glm-5.3",
      systemPrompt: options.config?.systemPrompt ?? DEFAULT_CEO_SYSTEM_PROMPT,
      temperature: options.config?.temperature ?? 0.3,
      maxOutputTokens: options.config?.maxOutputTokens ?? 16384,
      includeReasoning: options.config?.includeReasoning ?? false,
    };
    this.executeFn = options.execute;
    // Only expose LLM execute surface when wiring is present; this preserves
    // the decision-layer isolation check (ceo.execute === undefined when not LLM-wired).
    if (this.executeFn !== undefined) {
      (this as unknown as { execute: (input: AgentExecutionInput, signal: CancellationToken) => Promise<AgentExecutionOutput> }).execute = this.executeLlm.bind(this);
    }
  }

  // -------------------------------------------------------------------------
  // Deterministic legacy path — retained for existing tests / decideBusinessCycle
  // -------------------------------------------------------------------------
  decide(request: ExecutiveObjectiveInput): ExecutiveDirective {
    if (!isRecord(request) || request === null) throw new Error("A decision request is required");
    validateObjective(request.objective);

    const intent = request.intent;
    if (!isWorkflowIntent(intent)) throw new Error(`Unsupported workflow intent: ${JSON.stringify(intent)}`);

    const priority = (request.priority ?? "medium") as Priority;
    validatePriority(priority);

    const constraints = normalizeConstraints(request.constraints);

    const templateAgents = templateAgentsFor(intent as WorkflowIntent);
    assertAgentsAvailable(templateAgents, this.registry);

    const seeded = { objective: request.objective, intent, priority, constraints };
    const canonical = JSON.stringify(seeded);

    const createdAt = this.clock();
    const directiveId = deriveId(canonical);
    const evidenceId = deriveId(`${canonical}#decision-evidence`);

    const evidence: DecisionEvidence = {
      kind: "executive_decision",
      evidenceId,
      directiveId,
      objective: request.objective,
      selectedWorkflow: intent as WorkflowIntent,
      selectedAgents: templateAgents,
      decisionSource: this.decisionSource,
      decidedAt: createdAt,
    };

    return {
      directiveId,
      objective: request.objective,
      workflowIntent: intent as WorkflowIntent,
      priority,
      requestedStages: templateAgents,
      constraints,
      createdAt,
      decisionEvidence: evidence,
    };
  }

  // -------------------------------------------------------------------------
  // LLM path — strategy council synthesis of 7 specialist reports via glm-5.3 (AgentRouter OPENAI_COMPATIBLE)
  // This method is only attached when an LLM execute dependency is wired; otherwise
  // the instance remains a pure decision layer (ceo.execute === undefined) per
  // the existing contract test.
  // -------------------------------------------------------------------------
  private async executeLlm(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    const raw = input.input as unknown as Record<string, unknown>;
    const boundedDecision = raw.requiredDecision;
    if (raw.productionPhase === "PRE_MEDIA_PHASE"
      && typeof boundedDecision === "string"
      && ["ADVANCE", "HOLD", "RETURN_TO_OWNER", "NO_PRODUCTION_CANDIDATE"].includes(boundedDecision)
      && Array.isArray(raw.eligibleCandidateIds)) {
      const output = {
        decision: boundedDecision,
        rationale: `Canonical evidence gate selected ${boundedDecision}.`,
        eligibleCandidateIds: raw.eligibleCandidateIds,
        warnings: boundedDecision === "ADVANCE" ? [] : ["No production advance without an eligible evidence-backed candidate."],
        policy: typeof raw.policy === "string" ? raw.policy : "amf-evidence-sufficiency-v1",
      } as unknown as Json;
      return {
        output,
        response: {
          output,
          raw: JSON.stringify(output),
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: this.ceoConfig.model,
          provider: "ceo-evidence-gate",
          latencyMs: 0,
        },
      };
    }
    const validated = (raw as { validatedArtifacts?: unknown }).validatedArtifacts;
    const hasCouncilEvidence = Array.isArray(validated) && validated.length > 0;
    if (hasCouncilEvidence) {
      return this.executeCouncilSynthesis(input, signal);
    }
    if (typeof raw.objective === "string" && typeof raw.intent === "string") {
      const directive = this.decide(raw as unknown as ExecutiveObjectiveInput);
      const output: Json = directive as unknown as Json;
      return {
        output,
        response: {
          output,
          raw: JSON.stringify(directive, null, 2),
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: this.ceoConfig.model,
          provider: "ceo-deterministic",
          latencyMs: 0,
        },
      };
    }
    throw new Error("Invalid CEO input: expected ExecutiveObjectiveInput or strategy council validatedArtifacts");
  }

  private async executeCouncilSynthesis(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    const raw = input.input as unknown as { validatedArtifacts?: readonly { artifactId: string; kind: string; producerAgent: string; workflowId: string; correlationId: string; status: string; payload: Json }[]; requestId?: string; objective?: string; workflowId?: string; correlationId?: string; cycle?: number; ownerStrategicInput?: Json; referenceContentEvidence?: Json };
    const artifacts = (raw.validatedArtifacts ?? []) as readonly { artifactId: string; kind: string; producerAgent: string; workflowId: string; correlationId: string; status: string; createdAt: string; payload: Json }[];
    const { directive, response: executionResponse } = await this.createCouncilDirective(raw, artifacts, input.context, signal);
    const output: Json = directive as unknown as Json;
    const response: ExecutionResponse = { ...executionResponse, output, raw: JSON.stringify(directive, null, 2) };
    return { output, response };
  }

  private async createCouncilDirective(
    raw: { objective?: string; requestId?: string; workflowId?: string; correlationId?: string; cycle?: number; ownerStrategicInput?: Json; referenceContentEvidence?: Json },
    artifacts: readonly { artifactId: string; kind: string; producerAgent: string; workflowId: string; correlationId: string; status: string; createdAt: string; payload: Json }[],
    context: ExecutionContext,
    signal: CancellationToken,
  ): Promise<{ directive: ExecutiveDirective | StrategyCouncilSynthesisV2; response: ExecutionResponse }> {
    signal.throwIfCancelled();
    const workflowId = raw.workflowId ?? artifacts[0]?.workflowId ?? "";
    const correlationId = raw.correlationId ?? artifacts[0]?.correlationId ?? "";
    const isV2Council = artifacts.length === 7;
    if (isV2Council) {
      validateStrategyCouncilV2Manifest(artifacts, workflowId, correlationId);
      const evidence = artifacts.map((artifact) => ({ artifactId:artifact.artifactId, kind:artifact.kind, producerAgent:artifact.producerAgent, payload:JSON.stringify(artifact.payload).slice(0,2400) }));
      const prompt = `${STRATEGY_COUNCIL_V2_SYSTEM_PROMPT}\nA. BOUNDED BUSINESS INPUT\nObjective: ${raw.objective ?? "Produce an owner-review Strategy Council V2 synthesis"}.\nOwner input: ${JSON.stringify(raw.ownerStrategicInput ?? {}).slice(0,2400)}\nReference evidence: ${JSON.stringify(raw.referenceContentEvidence ?? {}).slice(0,2400)}\nCanonical specialist evidence: ${JSON.stringify(evidence)}\nB. MACHINE-READABLE OUTPUT SCHEMA\n${JSON.stringify(STRATEGY_COUNCIL_V2_RESPONSE_SCHEMA)}\nC. EXACT NEUTRAL SHAPE TEMPLATE\n${JSON.stringify(STRATEGY_COUNCIL_V2_EXAMPLE)}\nD. OUTPUT RULES\nReturn exactly one JSON object with exact primitive/array/object shapes, field names, enums, and cardinalities. No Markdown fences or prose outside JSON. Never wrap primitive fields in objects or replace arrays with objects.\n${STRATEGY_COUNCIL_V2_OUTPUT_INSTRUCTIONS}`;
      const response = await this.runExecution(context, this.buildExecutionRequest(prompt, STRATEGY_COUNCIL_V2_RESPONSE_SCHEMA, STRATEGY_COUNCIL_V2_SYSTEM_PROMPT), signal);
      return { directive: validateStrategyCouncilSynthesisV2(response.output), response };
    }
    const prompt = this.buildCouncilPrompt(raw, artifacts);
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, request, signal);
    return { directive: this.parseCEOResponse(response.output, artifacts, raw), response };
  }

  private async runExecution(context: ExecutionContext, request: ExecutionRequest, signal: CancellationToken): Promise<ExecutionResponse> {
    if (this.executeFn === undefined) throw new Error("CEO LLM execution not configured: execute mock required for strategy council synthesis");
    return this.executeFn(context, request, signal);
  }

  private buildCouncilPrompt(
    raw: { objective?: string; requestId?: string; workflowId?: string; correlationId?: string; cycle?: number; ownerStrategicInput?: Json; referenceContentEvidence?: Json },
    artifacts: readonly { artifactId: string; kind: string; payload: Json; workflowId?: string; correlationId?: string }[],
  ): string {
    const byKind = (kind: string) => artifacts.filter((a) => a.kind === kind);
    const research = byKind("research_report");
    const planner = artifacts.filter((a) => a.kind === "execution_plan" || a.kind === "evidence_backed_content_brief");
    const bySpecialist = (agent: string, legacyKind: string) => artifacts.filter((a) => a.kind === legacyKind || a.kind === `strategy_council_${agent}_v2`);
    const writer = bySpecialist("writer", "writer_report");
    const seo = bySpecialist("seo", "seo_report");
    const brand = bySpecialist("brand", "brand_report");
    const growth = bySpecialist("growth", "growth_report");
    const finance = bySpecialist("finance", "finance_report");
    const describe = (list: readonly { artifactId: string; kind: string; payload: Json; workflowId?: string; correlationId?: string }[]) => list.length === 0 ? "(none)" : list.map((a) => `- ${a.kind}:${a.artifactId} payload=${JSON.stringify(a.payload).slice(0, 1600)}`).join("\n");
    const objective = raw.objective ?? "Synthesize the 7 specialist reports into a grounded executive directive for the next business cycle";
    const workflowId = (raw.workflowId ?? artifacts[0]?.workflowId ?? "") as string;
    const correlationId = (raw.correlationId ?? artifacts[0]?.correlationId ?? "") as string;
    const cycle = raw.cycle ?? 1;
    const registryInfo = this.registry !== undefined ? "registry-constrained" : "open";
    return `${this.ceoConfig.systemPrompt}

STRATEGY COUNCIL SYNTHESIS (PRE_PUBLICATION) — 7 specialist reports → ExecutiveDirective via glm-5.3 (AgentRouter OPENAI_COMPATIBLE).

Council objective:
${objective}
Cycle: ${cycle}  workflowId: ${workflowId}  correlationId: ${correlationId}  registry: ${registryInfo}
RequestId: ${raw.requestId ?? `ceo-council-${workflowId}-${cycle}`}

Owner-approved strategic input (constraint, not a specialist report):
${JSON.stringify(raw.ownerStrategicInput ?? {})}

Reference-content evidence (research intelligence only; no production reuse rights):
${JSON.stringify(raw.referenceContentEvidence ?? {})}

Supplied specialist reports (ground truth — do not invent):
RESEARCH (${research.length}):
${describe(research)}

PLANNER (${planner.length}):
${describe(planner)}

WRITER (${writer.length}):
${describe(writer)}

SEO (${seo.length}):
${describe(seo)}

BRAND (${brand.length}):
${describe(brand)}

GROWTH strategy (${growth.length}):
${describe(growth)}

FINANCE strategy (${finance.length}):
${describe(finance)}

Produce a valid ExecutiveDirective JSON with:
- directiveId (UUID-like or deterministic hash string),
- objective (grounded synthesis of the 7 reports, must reference contentId and at least one validated figure if present),
- workflowIntent (one of "plan" | "research" | "implement" | "verify" | "ship" — choose "implement" for strategy council unless evidence dictates otherwise),
- priority ("low" | "medium" | "high" | "urgent" — derive from finance profit/roi and growth losing patterns, never invent),
- requestedStages (array of agent ids; must be subset of available workflow agents, never invent),
- constraints (object, may be empty),
- createdAt (ISO timestamp),
- decisionEvidence { kind:"executive_decision", evidenceId, directiveId, objective, selectedWorkflow, selectedAgents, decisionSource:"${BUSINESS_SOURCE}", decidedAt },
- successCriteria (array of strings, each grounded in validated figures — e.g., "improve losing metric: watch_time", "sustain ROI above 1.5"),
- rationale (string describing the grounded decision, must mention finance_report/growth_report lineage),
- sourceArtifactReferences (array of { artifactId, kind } — include the 7 specialist artifact ids you used, never invent),
- cycle (number, set to ${cycle})

Constraints:
- Every sourceArtifactReference must be an exact artifactId/kind from the list above.
- Priority must be grounded: profit < 0 → urgent, roi < 1 → high, otherwise medium.
- Do not invent artifact ids, metrics, or revenue figures.
- Output ONLY the JSON directive, no explanatory text.`;
  }

  private buildExecutionRequest(prompt: string, responseSchema = this.getCEOResponseSchema(), systemPrompt = this.ceoConfig.systemPrompt): ExecutionRequest {
    return {
      model: this.ceoConfig.model,
      system: systemPrompt,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.ceoConfig.temperature,
      maxOutputTokens: this.ceoConfig.maxOutputTokens,
      responseSchema,
    };
  }

  private getCEOResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        directiveId: { type: "string" },
        objective: { type: "string" },
        workflowIntent: { type: "string", enum: ["plan", "research", "implement", "verify", "ship"] },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
        requestedStages: { type: "array", items: { type: "string" } },
        constraints: { type: "object" },
        createdAt: { type: "string" },
        decisionEvidence: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["executive_decision"] },
            evidenceId: { type: "string" },
            directiveId: { type: "string" },
            objective: { type: "string" },
            selectedWorkflow: { type: "string", enum: ["plan", "research", "implement", "verify", "ship"] },
            selectedAgents: { type: "array", items: { type: "string" } },
            decisionSource: { type: "string" },
            decidedAt: { type: "string" },
          },
          required: ["kind", "evidenceId", "directiveId", "objective", "selectedWorkflow", "selectedAgents", "decisionSource", "decidedAt"],
        },
        successCriteria: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
        sourceArtifactReferences: { type: "array", items: { type: "object", properties: { artifactId: { type: "string" }, kind: { type: "string" } }, required: ["artifactId", "kind"] } },
        cycle: { type: "number" },
      },
      required: ["directiveId", "objective", "workflowIntent", "priority", "requestedStages", "constraints", "createdAt", "decisionEvidence"],
    };
  }

  private parseCEOResponse(
    output: Json,
    artifacts: readonly { artifactId: string; kind: string }[],
    raw: { requestId?: string },
  ): ExecutiveDirective {
    if (!isJsonRecord(output)) throw new Error("Invalid CEO response: directive must be an object");
    const required = ["directiveId", "objective", "workflowIntent", "priority", "requestedStages", "constraints", "createdAt", "decisionEvidence"];
    for (const key of required) {
      if ((output as { [k: string]: Json })[key] === undefined) throw new Error(`Invalid CEO response: missing field ${key}`);
    }
    const allowedIds = new Set(artifacts.map((a) => String(a.artifactId)));
    const refs = (output as { [k: string]: Json }).sourceArtifactReferences;
    if (refs !== undefined) {
      if (!Array.isArray(refs)) throw new Error("Invalid CEO response: sourceArtifactReferences must be an array");
      for (const r of refs as Json[]) {
        if (!isJsonRecord(r) || typeof r.artifactId !== "string" || typeof r.kind !== "string") throw new Error("Invalid CEO response: invalid sourceArtifactReference");
        if (artifacts.length > 0 && !allowedIds.has(String(r.artifactId))) throw new Error("Invalid CEO response: source reference not present in supplied specialist reports");
      }
    }
    if (!Array.isArray(refs) || refs.length !== artifacts.length || new Set(refs.map((reference) => String((reference as { artifactId?: Json }).artifactId))).size !== refs.length) {
      throw new Error("Invalid CEO response: synthesis must reference each supplied specialist artifact exactly once");
    }
    if (!Array.isArray(output.successCriteria) || output.successCriteria.length === 0 || typeof output.rationale !== "string" || output.rationale.trim().length < 80) {
      throw new Error("Invalid CEO response: synthesis rationale and success criteria are not substantive");
    }
    const ev = (output as { [k: string]: Json }).decisionEvidence;
    if (!isJsonRecord(ev) || ev.kind !== "executive_decision" || typeof ev.evidenceId !== "string" || typeof ev.directiveId !== "string") {
      throw new Error("Invalid CEO response: invalid decisionEvidence");
    }
    if (String(output.directiveId) !== String(ev.directiveId)) {
      throw new Error("Invalid CEO response: directiveId mismatch with decisionEvidence");
    }
    const priority = String(output.priority);
    if (!["low", "medium", "high", "urgent"].includes(priority)) throw new Error("Invalid CEO response: invalid priority");
    const intent = String(output.workflowIntent);
    if (!["plan", "research", "implement", "verify", "ship"].includes(intent)) throw new Error("Invalid CEO response: invalid workflowIntent");

    return output as unknown as ExecutiveDirective;
  }
}

/** Factory function to create a CEOAgent with defaults (model glm-5.3 via AgentRouter OPENAI_COMPATIBLE). */
export function createCEOAgent(options?: CEODependencies): CEOAgent {
  const config: CEOConfig = {
    model: options?.config?.model ?? "glm-5.3",
    systemPrompt: options?.config?.systemPrompt ?? DEFAULT_CEO_SYSTEM_PROMPT,
    temperature: options?.config?.temperature ?? 0.3,
    maxOutputTokens: options?.config?.maxOutputTokens ?? 16384,
    includeReasoning: options?.config?.includeReasoning ?? false,
  };
  return new CEOAgent({ ...(options ?? {}), config });
}
