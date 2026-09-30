import { AgentInvocationContractError, getDefaultRegistry, type AgentInstance, type AgentRegistration, type Json, type ExecutionContext, type AgentExecutionDescriptor } from "@ai-media-factory/agent-registry";
import { createProductionAgentExecutor } from "./production-executor.js";

const AGENTS = [
  ["planner", "Planner Agent", "Plans content workflows."],
  ["research", "Research Agent", "Produces source-backed research."],
  ["writer", "Writer Agent", "Produces written content artifacts."],
  ["review", "Reviewer Agent", "Reviews content artifacts."],
  ["seo", "SEO Agent", "Optimizes content for discovery."],
  ["brand", "Brand Agent", "Applies brand and safety gates."],
  ["thumbnail", "Thumbnail Agent", "Plans thumbnails."],
  ["video", "Video Agent", "Plans video production."],
  ["qa", "QA Agent", "Validates production artifacts."],
  ["publisher", "Publisher Agent", "Controls publication readiness."],
  ["publisher-authorization", "Publisher Authorization Agent", "Gates publication authorization."],
  ["analytics", "Analytics Agent", "Measures published content."],
  ["director", "Director Agent", "Plans production scenes."],
  ["tts", "Narration Agent", "Plans narration artifacts."],
  ["timeline", "Timeline Agent", "Plans timelines."],
  ["scene-image", "Scene Image Agent", "Plans scene visuals."],
  ["visual-semantic-review", "Visual Semantic Review Agent", "Reviews visual semantics."],
  ["visual-technical-qa", "Visual Technical QA Agent", "Checks visual technical quality."],
  ["wan-authorization", "Wan Authorization Agent", "Gates video generation authorization."],
  ["composer", "Composer Agent", "Composes final media."],
  ["visual-director", "Visual Director Agent", "Authors provider-neutral visual direction contracts (governed creative role; execution requires an explicitly authorized creative runtime)."],
  ["growth", "Growth Agent", "Analyzes validated performance inputs."],
  ["finance", "Finance Agent", "Analyzes validated financial inputs."],
  ["ceo", "CEO Agent", "Synthesizes validated strategic council evidence."],
] as const;

const EXECUTION: Record<string, AgentExecutionDescriptor> = {
  planner: { mode: "workflow-stage", requiredArtifactKinds: ["execution_plan", "research_report"], outputArtifactKind: "evidence_backed_content_brief", providerKind: "hybrid" },
  research: { mode: "workflow-stage", requiredArtifactKinds: ["execution_plan"], outputArtifactKind: "research_report", providerKind: "hybrid" },
  writer: { mode: "workflow-stage", requiredArtifactKinds: ["evidence_backed_content_brief"], outputArtifactKind: "writer_report", providerKind: "llm" },
  seo: { mode: "workflow-stage", requiredArtifactKinds: ["writer_report"], outputArtifactKind: "seo_report", providerKind: "llm" },
  brand: { mode: "workflow-stage", requiredArtifactKinds: ["seo_report"], outputArtifactKind: "brand_report", providerKind: "llm" },
  growth: { mode: "workflow-stage", requiredArtifactKinds: ["analytics_report"], outputArtifactKind: "growth_report", providerKind: "hybrid" },
  "visual-director": { mode: "workflow-stage", requiredArtifactKinds: ["scene_plan"], outputArtifactKind: "visual_direction_contract", providerKind: "llm" },
  finance: { mode: "workflow-stage", requiredArtifactKinds: ["analytics_report"], outputArtifactKind: "finance_report", providerKind: "hybrid" },
  ceo: { mode: "workflow-stage", requiredArtifactKinds: ["research_report"], outputArtifactKind: "ceo_recommendation", providerKind: "llm" },
};

function metadata(id: string, name: string, description: string) {
  return {
    id, name, version: "1.0.0", description,
    capabilities: ["text-generation", "workflow-orchestration"], tags: ["production", "content"],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), execution: EXECUTION[id] ?? { mode: "workflow-stage", providerKind: "hybrid" },
  };
}

function delegatedAgent(id: string, _executor: ReturnType<typeof createProductionAgentExecutor>, meta: ReturnType<typeof metadata>): AgentInstance {
  return {
    id, metadata: meta, config: {},
    async initialize() {},
    async dispose() {},
    async health() { return { healthy: true, lastCheck: new Date().toISOString() }; },
    async execute(_input: Json, _context: ExecutionContext): Promise<Json> {
      // Registry resolution is intentionally not an execution escape hatch.
      // The canonical workflow runner owns context/artifact persistence and
      // invokes the same real implementation through ProductionAgentExecutor.
      throw new AgentInvocationContractError(id, meta.execution?.mode ?? "workflow-stage");
    },
  };
}

/** Canonical application bootstrap. Idempotent for repeated startup wiring. */
export async function bootstrapCanonicalAgentRegistry(options: { readonly executor?: ReturnType<typeof createProductionAgentExecutor> } = {}) {
  const registry = getDefaultRegistry();
  const executor = options.executor ?? createProductionAgentExecutor();
  for (const [id, name, description] of AGENTS) {
    if (registry.has(id)) continue;
    const meta = metadata(id, name, description);
    const registration: AgentRegistration = {
      metadata: meta, configSchema: { type: "object", properties: {} }, defaultConfig: {}, state: "REGISTERED",
      factory: async () => delegatedAgent(id, executor, meta),
    };
    await registry.register(registration);
  }
  return registry;
}
