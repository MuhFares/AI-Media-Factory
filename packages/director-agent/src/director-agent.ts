import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, CapabilityResult, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import { TIMELINE_PLAN_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import type { DirectorAgentConfig, DirectorAgentDependencies, DirectorAgentInput, DirectorReport, SceneVisualBrief } from "./director-types.js";
import { isDirectorAgentInput, isPreTtsScenePlanInput, toCapabilityRequest } from "./director-types.js";

const DEFAULT_DIRECTOR_SYSTEM_PROMPT = `You are a director agent. Before TTS, create a provider-neutral scene plan. Only the explicit legacy timeline mode may request timeline.plan after narration duration is available.`;

export { DEFAULT_DIRECTOR_SYSTEM_PROMPT };
type JsonRecord = { [key: string]: Json };
function isRecord(v: Json): v is JsonRecord { return v !== null && typeof v === "object" && !Array.isArray(v); }

export class DirectorAgent extends BaseAgent {
  readonly id: AgentId = "director";
  readonly name = "Director Agent";
  readonly version = "1.0.0";
  private readonly config: DirectorAgentConfig;
  constructor(deps: DirectorAgentDependencies) {
    super(deps as unknown as ConstructorParameters<typeof BaseAgent>[0]);
    this.config = deps.config;
  }
  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isDirectorAgentInput(input.input)) throw new Error("Invalid director input: expected pre-TTS scene-plan input or legacy narration-timed input");
    if (isPreTtsScenePlanInput(input.input)) return this.buildScenePlanOutput(input.input);
    const req = toCapabilityRequest(input.input, this.id,
      typeof input.input.workflowId === "string" ? input.input.workflowId : `workflow-${input.input.requestId}`,
      typeof input.input.correlationId === "string" ? input.input.correlationId : "");
    const executions = await this.runCapabilities([req]);
    return this.buildOutput(input.input, executions[0]);
  }
  private buildScenePlanOutput(input: DirectorAgentInput): AgentExecutionOutput {
    const workflowId = input.workflowId ?? `workflow-${input.requestId}`;
    const segments = input.script.split(/(?<=[.!?؟])\s+/u).map((s) => s.trim()).filter(Boolean);
    const source = segments.length === 0 ? [input.script.trim()] : segments;
    // A short-form production scene plan needs an establishing, development,
    // and resolving beat even when the supplied script is only one sentence.
    // This remains semantic scene decomposition owned by Director, not timing.
    while (source.length < 3) source.push(`${input.script.trim()} — ${["establish", "develop", "resolve"][source.length - 1] ?? "continue"} the visual idea.`);
    const scenes: SceneVisualBrief[] = source.map((segment, index) => ({
      sceneId: `scene-${String(index + 1).padStart(3, "0")}`,
      narrationSegment: segment,
      visualIntent: `Visually advance: ${segment.slice(0, 120)}`,
      subject: input.objective,
      environment: input.culturalContext ?? "context appropriate to the script",
      style: input.visualStyle ?? "documentary",
      continuityRequirements: [],
      forbiddenElements: [],
      motionIntent: "gentle motivated camera motion",
      referenceStrategy: input.referenceStrategy ?? "none",
    }));
    const report: DirectorReport = {
      reportId: input.requestId,
      taskDescription: input.taskDescription ?? "Create a pre-TTS visual scene plan",
      objective: input.objective,
      status: "completed",
      summary: "Provider-neutral scene plan created before TTS; final timing is deferred to the Timeline stage.",
      timelineId: "",
      sceneCount: scenes.length,
      plannedVisualDurationMs: 0,
      coverageRatio: 0,
      executionEvidencePresent: true,
      scenePlan: { planId: `scene-plan-${input.requestId}`, workflowId, scenes },
      metadata: { createdAt: new Date().toISOString(), agentVersion: this.version, providerId: "director-deterministic" },
    };
    const output = this.toJson(report);
    return { output, response: { output, raw: JSON.stringify(report, null, 2), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, model: this.config.model, provider: "director-deterministic", latencyMs: 0 } };
  }
  private buildOutput(input: DirectorAgentInput, execution: CapabilityResult | undefined): { output: Json; response: ExecutionResponse } {
    const taskDescription = input.taskDescription ?? "Plan a scene timeline for the narration";
    const rec: JsonRecord | undefined = execution === undefined ? undefined : (JSON.parse(JSON.stringify(execution)) as JsonRecord);
    if (rec === undefined || rec["status"] !== "success") {
      const report = this.report(input, taskDescription, "blocked", this.failureReason(rec), { timelineId: "", sceneCount: 0, plannedVisualDurationMs: 0, coverageRatio: 0 });
      return this.wrap(report, rec);
    }
    const evidence = isRecord(rec["evidence"] as Json) ? (rec["evidence"] as JsonRecord) : {};
    const output = isRecord(rec["output"] as Json) ? (rec["output"] as JsonRecord) : {};
    const isGranted = evidence["capabilityId"] === TIMELINE_PLAN_CAPABILITY_ID && evidence["agentId"] === this.id && evidence["succeeded"] === true;
    const timelineId = typeof output["timelineId"] === "string" ? output["timelineId"] : "";
    if (!isGranted || timelineId === "") {
      const report = this.report(input, taskDescription, "blocked", "Blocked: timeline.plan did not return matching completion evidence.", { timelineId: "", sceneCount: 0, plannedVisualDurationMs: 0, coverageRatio: 0 });
      return this.wrap(report, rec);
    }
    const report = this.report(input, taskDescription, "completed", "Timeline planned via timeline.plan with matching evidence.", {
      timelineId,
      sceneCount: typeof output["sceneCount"] === "number" ? output["sceneCount"] as number : 0,
      plannedVisualDurationMs: typeof output["plannedVisualDurationMs"] === "number" ? output["plannedVisualDurationMs"] as number : 0,
      coverageRatio: typeof output["coverageRatio"] === "number" ? output["coverageRatio"] as number : 0,
    });
    return this.wrap(report, rec);
  }
  private report(input: DirectorAgentInput, taskDescription: string, status: "completed" | "blocked", summary: string, f: { timelineId: string; sceneCount: number; plannedVisualDurationMs: number; coverageRatio: number }): DirectorReport {
    return { reportId: input.requestId, taskDescription, objective: input.objective, status, summary, timelineId: f.timelineId, sceneCount: f.sceneCount, plannedVisualDurationMs: f.plannedVisualDurationMs, coverageRatio: f.coverageRatio, executionEvidencePresent: status === "completed", metadata: { createdAt: new Date().toISOString(), agentVersion: this.version, providerId: "deterministic-v1" } };
  }
  private failureReason(ex: JsonRecord | undefined): string {
    if (ex === undefined) return "timeline.plan was not executed or capability execution is not configured.";
    if (ex["status"] === "blocked") return `timeline.plan was blocked: ${typeof ex["reason"] === "string" ? ex["reason"] : "unknown"}`;
    if (ex["status"] === "failed") { const err = isRecord(ex["error"] as Json) ? (ex["error"] as JsonRecord) : {}; return `timeline.plan failed: ${typeof err["message"] === "string" ? err["message"] : "unknown"}`; }
    return "timeline.plan did not succeed.";
  }
  private wrap(report: DirectorReport, execution: JsonRecord | undefined): { output: Json; response: ExecutionResponse } {
    const base = this.toJson(report) as unknown as JsonRecord;
    const withExec: Json = execution !== undefined ? { ...base, capabilityExecutions: [execution] as unknown as Json } : (base as unknown as Json);
    return { output: withExec, response: { output: withExec, raw: JSON.stringify(report, null, 2), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, model: this.config.model, provider: "director-deterministic", latencyMs: 0 } };
  }
  private toJson(r: DirectorReport): Json {
    return { reportId: r.reportId, taskDescription: r.taskDescription, objective: r.objective, status: r.status, summary: r.summary, timelineId: r.timelineId, sceneCount: r.sceneCount, plannedVisualDurationMs: r.plannedVisualDurationMs, coverageRatio: r.coverageRatio, executionEvidencePresent: r.executionEvidencePresent, ...(r.scenePlan ? { scenePlan: { ...r.scenePlan, scenes: r.scenePlan.scenes.map((scene) => ({ ...scene, continuityRequirements: [...scene.continuityRequirements], forbiddenElements: [...scene.forbiddenElements] })) } } : {}), metadata: { ...r.metadata } };
  }
}

export function createDirectorAgent(deps: DirectorAgentDependencies): DirectorAgent {
  const config: DirectorAgentConfig = { ...deps.config, model: deps.config?.model ?? "deterministic", systemPrompt: deps.config?.systemPrompt ?? DEFAULT_DIRECTOR_SYSTEM_PROMPT };
  return new DirectorAgent({ ...deps, config });
}
