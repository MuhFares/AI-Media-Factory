/** Reusable command/runtime execution primitives.  This module has no HTTP/UI knowledge. */
import { createHash, randomUUID } from "node:crypto";
import type { CollaborationArtifact, Json } from "@ai-media-factory/shared";
import type { PersistencePort } from "@ai-media-factory/workflow-engine";
import type { ExecutionResponse } from "@ai-media-factory/runtime";
import { executionProvenance } from "./model-performance-attribution.js";
import { executeGovernedVisibleJson } from "./production-executor.js";
import { assertMorrowayHistoricalContext } from "./project-context.js";
import { validateInternalAnalysisV2, internalAnalysisSections, participantContract, effectiveExecutionPolicy, recommendsOwnerDecision, ceoSynthesisBudget } from "./research-contracts.js";
import type { InternalAnalysisTruth } from "./research-contracts.js";

export type GovernedProvider = "agentrouter" | "openrouter";
export type CommandExecutionStatus = "QUEUED" | "WORKING" | "COMPLETED" | "FAILED" | "BLOCKED";
export type EffectiveRuntimeConfig = Readonly<{
  provider: GovernedProvider; model: string; source: "GLOBAL" | "PROJECT" | "AGENT";
  routingVersionId?: string; routingScope?: string; priceSnapshotId?: string; preflightFingerprint?: string;
}>;
export type GovernedAgentRequest = Readonly<{ workflowId: string; correlationId?: string | null; projectId: string; agentId: string; prompt: string; context?: Record<string, Json>; config: EffectiveRuntimeConfig; outputBudget?: number; reasoning?: { readonly effort: "none" }; strategicSnapshotId?: string | null }>;
export type GovernedAgentResult = Readonly<{ executionId: string; agentId: string; status: CommandExecutionStatus; output: Json | null; artifactId: string | null; provider: string; requestedModel: string; actualModel: string | null; provenance: Record<string, Json>; strategicSnapshotId?: string | null; error?: string }>;

type Execute = (input: { agentId: string; workflowId: string; correlationId?: string | null; provider: GovernedProvider; model: string; system: string; prompt: string; metadata?: Record<string, Json>; maxOutputTokens?: number; reasoning?: { readonly effort: "none" } }) => Promise<ExecutionResponse>;
type Preflight = (input: { projectId: string; role: string; provider: GovernedProvider; model: string; routingVersionId?: string; prompt: string; system: string; outputTokens: number }) => Promise<{ fingerprint: string }>;
const asRecord = (v: unknown): Record<string, Json> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, Json> : {};
const fingerprint = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const visibleJson = (response: ExecutionResponse): Json => {
  if (response.output === null || typeof response.output !== "object") throw new Error("GOVERNED_VISIBLE_JSON_REQUIRED");
  return response.output as Json;
};
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const stringField = (value: unknown): value is string => typeof value === "string";
const errorDiagnostics = (error: unknown): Record<string, Json> | null => {
  const value = error !== null && typeof error === "object" ? error as Record<string, unknown> : null;
  const diagnostics = value?.diagnostics;
  return diagnostics !== null && typeof diagnostics === "object" && !Array.isArray(diagnostics) ? diagnostics as Record<string, Json> : null;
};

/**
 * Slice 5 remediation V5 — canonical actionability truth for V2 validation.
 * Count AND currently-actionable decision IDs come from the operational
 * block; absent/invalid truth yields count -1 with no ID list, which the
 * V2 validator treats as structure-only (same leniency as V1).
 */
function internalAnalysisTruth(context: Record<string, Json> | undefined, requestedCount: number): InternalAnalysisTruth {
  const operational = asRecord(context?._operational);
  const approvals = asRecord(operational.approvals);
  const count = typeof approvals.actionable === "number" ? approvals.actionable : null;
  const ids = Array.isArray(approvals.actionableIds)
    ? approvals.actionableIds.filter((v): v is string => typeof v === "string" && v.length > 0)
    : null;
  return {
    requestedCount,
    actionableDecisions: Number.isFinite(count) ? Number(count) : -1,
    ...(ids ? { actionableIds: ids } : {}),
  };
}

/** Reject malformed provider JSON before it can become a canonical artifact. */
export function assertRoleContract(agentId: string, output: Json): void {
  const value = asRecord(output);
  const required = agentId === "research"
    ? ["concept", "historicalAngle", "evidenceConsiderations", "sourceability", "risks", "recommendation"]
    : agentId === "planner"
      ? ["hook", "shortFormStructure", "audienceAppeal", "pilotFit", "risks", "recommendation"]
      : agentId === "ceo"
        ? ["agreements", "disagreements", "evidence", "recommendation", "confidence", "missingEvidence", "nextAction"]
        : [];
  if (required.some((field) => value[field] === undefined || value[field] === null)) throw new Error(`COMMAND_ROLE_CONTRACT_REQUIRED_FIELD_INVALID:${agentId}`);
  const strings = agentId === "research"
    ? ["concept", "historicalAngle", "sourceability", "recommendation"]
    : agentId === "planner"
      ? ["hook", "audienceAppeal", "pilotFit", "recommendation"]
      : agentId === "ceo" ? ["recommendation", "nextAction"] : [];
  const arrays = agentId === "research"
    ? ["evidenceConsiderations", "risks"]
    : agentId === "planner"
      ? ["shortFormStructure", "risks"]
      : agentId === "ceo" ? ["agreements", "disagreements", "evidence", "missingEvidence"] : [];
  if (strings.some((field) => !stringField(value[field])) || arrays.some((field) => !stringArray(value[field]))) throw new Error(`COMMAND_ROLE_CONTRACT_TYPE_INVALID:${agentId}`);
  if (agentId === "ceo" && (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) throw new Error("COMMAND_ROLE_CONTRACT_TYPE_INVALID:ceo");
}

function assertMorrowayOutputGrounding(request: GovernedAgentRequest, output: Json): void {
  if (request.projectId.toLowerCase() !== "morroway" || !/historical\s+(pov|perspective)/i.test(request.prompt)) return;
  if (/\b(dwemer|morrowind|elder\s+scrolls|players?|gameplay|in-game|fictional\s+franchise)\b/i.test(JSON.stringify(output))) throw new Error("MORROWAY_OUTPUT_GROUNDING_INVALID");
}

function freezeJson<T extends Json>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child as Json);
    Object.freeze(value);
  }
  return value;
}

/**
 * Task-class output budgets (maxOutputTokens) for governed executions.
 *
 * Derived from each role's response-contract worst case, not tuned per
 * prompt: research contract allows ~10 strings × 220 chars + structure
 * (~2500 bytes ≈ ≤700 tokens at a conservative 3.5 bytes/token), so the
 * budget is 1000 with headroom. The previous flat 500 was arithmetically
 * incapable of holding a worst-case valid research payload — proven when a
 * reasoning model additionally consumed completion budget on reasoning
 * tokens (observed: 672 reasoning tokens inside a 500 cap, zero visible
 * bytes, finish length). Other roles keep their proven values; change only
 * on failure evidence, never preemptively.
 */
export { ROLE_OUTPUT_BUDGETS as GOVERNED_OUTPUT_BUDGETS, ROLE_DEFAULT_OUTPUT_BUDGET as GOVERNED_DEFAULT_OUTPUT_BUDGET, roleOutputBudget as governedOutputBudget } from "./research-contracts.js";

/** A provider-neutral, fail-closed execution service. */
export class GovernedAgentRuntime {
  constructor(private readonly persistence: Pick<PersistencePort, "saveArtifact" | "listArtifacts"> & Partial<Pick<PersistencePort, "saveExecutionProvenance">>, private readonly execute: Execute = executeGovernedVisibleJson, private readonly preflight?: Preflight) {}

  async executeGovernedAgent(request: GovernedAgentRequest): Promise<GovernedAgentResult> {
    const executionId = randomUUID(); const startedAt = new Date().toISOString(); const started = Date.now();
    const base = { commandRuntime: "GENERALIZED_AGENT_EXECUTION_RUNTIME_V1", projectId: request.projectId, configSource: request.config.source, provider: request.config.provider, requestedModel: request.config.model, routingVersionId: request.config.routingVersionId ?? null, routingScope: request.config.routingScope ?? null, priceSnapshotId: request.config.priceSnapshotId ?? null, resolvedContext: request.context ?? {} };
    try {
      if (!request.config.model.trim()) throw new Error("GOVERNED_MODEL_REQUIRED");
      if (request.projectId.toLowerCase() === "morroway") assertMorrowayHistoricalContext(request.prompt, request.context ?? {});
      // Intent-aware contract routing (Slice 5 remediation V2): agent identity
      // alone never selects the response schema. Research + internal project
      // analysis resolves to the internal-analysis contract; everything else
      // keeps its existing contract byte-for-byte.
      // Intent-aware participant routing: AGENT + INTENT -> CONTRACT.
      // Planner doing internal analysis gets the shared analysis contract
      // with planner perspective; planner doing planning keeps canonical text.
      const participant = participantContract(request.agentId, request.prompt);
      const internalAnalysis = participant.kind === "INTERNAL_ANALYSIS";
      const findingCount = participant.findingCount;
      const researchContract = participant.contract;
      const contract = internalAnalysis
        ? `INTERNAL PROJECT ANALYSIS. ${participant.perspective} ${researchContract!.promptAppendix} Requested finding count: ${findingCount}. Use only the supplied AUTHORITATIVE PROJECT GOVERNANCE and operational context as evidence; never invent approvals, numbers, or events. No markdown or prose outside the JSON object.`
        : request.agentId === "research" ? 'Return exactly one compact JSON object with these seven and only these keys: {"concept":"string","historicalAngle":"string","evidenceConsiderations":["string"],"sourceability":"string","risks":["string"],"recommendation":"string"}. Every string must be concise (220 characters or fewer); each array must contain 1-3 concise strings. Do not omit a key. No markdown or prose outside the JSON object.' : request.agentId === "planner" ? 'Return exactly one compact JSON object with these six and only these keys: {"hook":"string","shortFormStructure":["string"],"audienceAppeal":"string","pilotFit":"string","risks":["string"],"recommendation":"string"}. Every string must be concise (220 characters or fewer); each array must contain 1-3 concise strings. Do not omit a key. No markdown or prose outside the JSON object.' : request.agentId === "ceo" ? 'Return exactly one compact JSON object with these seven and only these keys: {"agreements":["string"],"disagreements":["string"],"evidence":["string"],"recommendation":"string","confidence":0.0,"missingEvidence":["string"],"nextAction":"string"}. Every string must be concise (220 characters or fewer); each array must contain 0-3 concise strings. Do not omit a key. No markdown or prose outside the JSON object.' : 'Return one concise JSON object.';
      const system = `${contract}\nAUTHORITATIVE PROJECT GOVERNANCE:\n${JSON.stringify(request.context ?? {})}\nFor Morroway Historical POV, use real-world source-supported history only. Do not mention Morrowind, Elder Scrolls, games, gameplay, in-game, or franchise lore anywhere in the output, including as a disclaimer or negative comparison.`;
      // Contract-aware execution policy (Slice 5 live-validation remediation):
      // budget AND reasoning derive from the effective response contract, so
      // planner-internal can never again receive an internal contract with
      // legacy planner execution settings. Explicit caller options still win.
      const policy = effectiveExecutionPolicy({
        agentId: request.agentId, prompt: request.prompt,
        explicitBudget: request.outputBudget, explicitReasoning: request.reasoning,
      });
      const reasoning = policy.reasoning;
      const budget = policy.budget;
      const preflight = this.preflight
        ? await this.preflight({ projectId: request.projectId, role: request.agentId, provider: request.config.provider, model: request.config.model, routingVersionId: request.config.routingVersionId, prompt: request.prompt, system, outputTokens: budget })
        : null;
      const response = await this.execute({ agentId: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId, provider: request.config.provider, model: request.config.model, system, prompt: request.prompt, metadata: request.context, maxOutputTokens: budget, ...(reasoning ? { reasoning } : {}) });
      const parsedOutput = visibleJson(response);
      // Canonical actionability truth for V2 structured-authority validation.
      if (internalAnalysis) {
        const verdict = validateInternalAnalysisV2(parsedOutput, internalAnalysisTruth(request.context, findingCount));
        if (!verdict.ok) throw new Error(`INTERNAL_ANALYSIS_CONTRACT_INVALID:${verdict.reason}`);
      } else {
        assertRoleContract(request.agentId, parsedOutput);
      }
      assertMorrowayOutputGrounding(request, parsedOutput);
      const output = freezeJson(structuredClone(parsedOutput));
      const artifactId = `command-${request.workflowId}-${request.agentId}-${executionId}`;
      const sections = internalAnalysis
        ? internalAnalysisSections(output as unknown as { summary: string; findings: Array<{ title: string; finding: string; ownerImplication: string }>; recommendedNextStep: string | { action: string; actor: string; requiresOwnerDecision?: boolean } })
        : [];
      const summary = internalAnalysis ? String((output as Record<string, unknown>).summary ?? "") : "Validated governed command output.";
      const artifact = { artifactId, kind: "documentation_report", producerAgent: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId ?? "", status: "completed", payload: { resultId: artifactId, objective: request.prompt.slice(0, 500), status: "completed", summary, sections, generatedOnly: true, persistence: "not_written", visibleOutput: output, responseContract: internalAnalysis ? "INTERNAL_ANALYSIS_V2" : "CONTENT_RESEARCH_V1" }, contentType: "application/json", schemaVersion: "command-runtime-v1", createdAt: new Date().toISOString() } as unknown as CollaborationArtifact;
      await this.persistence.saveArtifact(artifact);
      const reloaded = (await this.persistence.listArtifacts(request.workflowId)).find((candidate) => candidate.artifactId === artifactId);
      if (!reloaded) throw new Error("COMMAND_ARTIFACT_RELOAD_FAILED");
      const reloadedOutput = asRecord(asRecord(reloaded.payload).visibleOutput);
      if (internalAnalysis) {
        const verdict = validateInternalAnalysisV2(reloadedOutput, internalAnalysisTruth(request.context, findingCount));
        if (!verdict.ok) throw new Error(`INTERNAL_ANALYSIS_CONTRACT_INVALID:reload:${verdict.reason}`);
      } else {
        assertRoleContract(request.agentId, reloadedOutput);
      }
      assertMorrowayOutputGrounding(request, reloadedOutput);
      const configuration = { ...base, preflightFingerprint: preflight?.fingerprint ?? request.config.preflightFingerprint ?? null };
      await this.persist({ executionId, request, startedAt, latencyMs: Date.now() - started, status: "success", response, artifactIds: [artifactId], configuration });
      return { executionId, agentId: request.agentId, status: "COMPLETED", output, artifactId, provider: response.provider, requestedModel: request.config.model, actualModel: response.model ?? null, strategicSnapshotId: request.strategicSnapshotId ?? null, provenance: { ...configuration, executionId, artifactId, outputFingerprint: fingerprint(output), strategicSnapshotId: request.strategicSnapshotId ?? null } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.persist({ executionId, request, startedAt, latencyMs: Date.now() - started, status: "failed", response: null, providerDiagnostics: errorDiagnostics(error), artifactIds: [], configuration: { ...base, error: message } });
      return { executionId, agentId: request.agentId, status: /unavailable|required/i.test(message) ? "BLOCKED" : "FAILED", output: null, artifactId: null, provider: request.config.provider, requestedModel: request.config.model, actualModel: null, strategicSnapshotId: request.strategicSnapshotId ?? null, provenance: { ...base, executionId, strategicSnapshotId: request.strategicSnapshotId ?? null }, error: message };
    }
  }

  async executeGovernedAgentGroup(requests: readonly GovernedAgentRequest[]): Promise<{ results: GovernedAgentResult[]; status: CommandExecutionStatus }> {
    const results: GovernedAgentResult[] = [];
    for (const request of requests) results.push(await this.executeGovernedAgent(request));
    return { results, status: results.every((r) => r.status === "COMPLETED") ? "COMPLETED" : results.some((r) => r.status === "COMPLETED") ? "COMPLETED" : "FAILED" };
  }

  async synthesizeAgentOutputs(input: { workflowId: string; correlationId?: string | null; projectId: string; prompt: string; context?: Record<string, Json>; strategicSnapshotId?: string | null; results: readonly GovernedAgentResult[]; config: EffectiveRuntimeConfig; reasoning?: { readonly effort: "none" } }): Promise<GovernedAgentResult> {
    const validated = input.results.filter((r) => r.status === "COMPLETED" && r.output !== null).map((r) => ({ agentId: r.agentId, artifactId: r.artifactId, output: r.output }));
    if (validated.length === 0) return { executionId: randomUUID(), agentId: "ceo", status: "BLOCKED", output: null, artifactId: null, provider: input.config.provider, requestedModel: input.config.model, actualModel: null, provenance: { validatedInputCount: 0 }, error: "NO_VALIDATED_AGENT_OUTPUTS" };
    // Slice 5 remediation V3/V5: synthesis inherits the same actionability truth.
    // A synthesis must never turn non-actionable pending history into an
    // Owner task. The operational block (when present) is the only source.
    // The CEO free-text contract has no structured authority fields, so the
    // conservative recommendsOwnerDecision backstop stays here ONLY (V5
    // removed prose scanning from participant validation, not from here).
    const operational = asRecord((input.context ?? {})._operational);
    const actionableRaw = (operational.approvals as Record<string, unknown> | undefined)?.actionable;
    const actionable = typeof actionableRaw === "number" ? actionableRaw : null;
    const grounding = actionable === 0
      ? "\nCanonical operational context reports zero actionable Owner decisions: do not recommend that the Owner approve, review, decide, or authorize anything now. Disagreements between participants must still be represented honestly."
      : "";
    // Contract-aware synthesis policy (finalization RCA command-1789913111377):
    // budget derives from the CEO schema ceiling and reasoning defaults to
    // effort:none, exactly like participants — an uncontrolled reasoning
    // model inside a flat cap fails length with zero visible bytes. An
    // explicit caller reasoning option still wins.
    const synthesisReasoning = input.reasoning ?? { effort: "none" as const };
    const result = await this.executeGovernedAgent({ workflowId: input.workflowId, correlationId: input.correlationId, projectId: input.projectId, context: input.context, strategicSnapshotId: input.strategicSnapshotId ?? null, agentId: "ceo", config: input.config, outputBudget: ceoSynthesisBudget(), reasoning: synthesisReasoning, prompt: `${input.prompt}\n\nValidated agent outputs only:\n${JSON.stringify(validated)}\n\nReturn JSON with exactly: agreements (array), disagreements (array), evidence (array), recommendation (string), confidence (number 0..1), missingEvidence (array), nextAction (string).${grounding}` });
    const payload = asRecord(result.output);
    if (result.status !== "COMPLETED" || !Array.isArray(payload.agreements) || !Array.isArray(payload.disagreements) || !Array.isArray(payload.evidence) || typeof payload.recommendation !== "string" || !Array.isArray(payload.missingEvidence) || typeof payload.nextAction !== "string") return { ...result, status: "FAILED", error: "SYNTHESIS_SCHEMA_INVALID" };
    if (actionable === 0 && recommendsOwnerDecision(payload.recommendation)) {
      return { ...result, status: "FAILED", error: "SYNTHESIS_ACTIONABILITY_INVALID:recommendation instructs an Owner decision with zero actionable decisions" };
    }
    if (actionable === 0 && recommendsOwnerDecision(payload.nextAction)) {
      return { ...result, status: "FAILED", error: "SYNTHESIS_ACTIONABILITY_INVALID:nextAction instructs an Owner decision with zero actionable decisions" };
    }
    return result;
  }

  private async persist(input: { executionId: string; request: GovernedAgentRequest; startedAt: string; latencyMs: number; status: "success" | "failed"; response: ExecutionResponse | null; providerDiagnostics?: Record<string, Json> | null; artifactIds: string[]; configuration: Record<string, unknown> }): Promise<void> {
    if (!this.persistence.saveExecutionProvenance) return;
    const rawDiagnostics = asRecord((input.response as unknown as { providerResponseDiagnostics?: unknown } | null)?.providerResponseDiagnostics);
    const providerDiagnostics = input.response === null ? input.providerDiagnostics ?? null : {
      httpStatus: rawDiagnostics.httpStatus ?? null, finishReason: rawDiagnostics.finishReason ?? null,
      requestedModel: rawDiagnostics.requestedModel ?? input.request.config.model, actualModel: rawDiagnostics.actualModel ?? input.response.model ?? null,
      maxTokens: rawDiagnostics.maxTokens ?? null, reasoningEffort: rawDiagnostics.reasoningEffort ?? null, responseFormat: rawDiagnostics.responseFormat ?? null,
      reasoningTokens: rawDiagnostics.reasoningTokens ?? null, visibleContentBytes: rawDiagnostics.visibleContentBytes ?? null,
      usage: rawDiagnostics.usage ?? null,
    };
    await this.persistence.saveExecutionProvenance(executionProvenance({ executionId: input.executionId, workflowId: input.request.workflowId, correlationId: input.request.correlationId ?? null, agentId: input.request.agentId, stage: `command:${input.request.agentId}`, capability: "agent.execute", provider: input.response?.provider ?? input.request.config.provider, model: input.response?.model ?? input.request.config.model, runtime: "GENERALIZED_AGENT_EXECUTION_RUNTIME_V1", promptVersion: "visible-json-v1", startedAt: input.startedAt, completedAt: new Date().toISOString(), latencyMs: input.latencyMs, status: input.status, usage: input.response ? { inputTokens: input.response.usage.inputTokens, outputTokens: input.response.usage.outputTokens, totalTokens: input.response.usage.inputTokens + input.response.usage.outputTokens } : null, costKind: input.response?.usage.costUsd ? "ACTUAL" : "UNKNOWN", cost: input.response?.usage.costUsd || null, currency: "USD", artifactIds: input.artifactIds, parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: input.status === "failed" ? "COMMAND_EXECUTION_FAILED" : null, strategicSnapshotId: input.request.strategicSnapshotId ?? null, configuration: { ...input.configuration, reasoningEffort: input.request.reasoning?.effort ?? null, ...(providerDiagnostics ? { providerDiagnostics } : {}) } }));
  }
}
