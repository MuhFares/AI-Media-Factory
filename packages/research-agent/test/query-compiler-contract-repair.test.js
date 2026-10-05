import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import {
  CANONICAL_DISCOVERY_LANES,
  createResearchAgent,
  evaluateDiscoveryQueryQuality,
  materializeDiscoveryRetrievalPlan,
  packWebSearchQuery,
} from "../dist/index.js";
import { canary11Direction } from "./fixtures/canary-11-direction.js";

const scope = {
  workflowId: "fixture-canary-11",
  correlationId: "fixture-canary-11",
  taskId: "research-research",
  executionScopeId: "regression",
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

const lanePurpose = {
  TREND_SIGNAL: "Find current trend signals",
  SOCIAL_CONTENT_SIGNAL: "Find current social content signals",
  SEARCH_DEMAND: "Find current search demand signals",
  COMPETITOR_PATTERN: "Find documented competitor patterns",
  HISTORICAL_OPPORTUNITY: "Discover documented historical opportunities",
  CURRENT_EVENT_CONNECTION: "Find current event connections",
  SEASONAL_CALENDAR: "Find historical dates anniversaries and calendar relevance",
  EVERGREEN_CURIOSITY: "Discover evergreen historical curiosity opportunities",
  FACTUAL_ARCHIVE_DISCOVERY: "Find institutional archive evidence",
};

describe("Research query compiler contract repair", () => {
  it("freezes the exact bounded Canary-11 Direction compiler fixture", () => {
    const hash = createHash("sha256").update(JSON.stringify(stable(canary11Direction))).digest("hex");
    strictEqual(hash, "810b04ccbad8bb5a17a1cc6cc32a1b59b91a1c56d2c7c4777e5bbc851ddd4829");
  });

  it("materializes every persisted Canary-11 lane without losing mandatory semantics", () => {
    const plan = materializeDiscoveryRetrievalPlan(canary11Direction, scope, 4);
    strictEqual(plan.length, 3);
    deepStrictEqual(plan.map((entry) => entry.laneId), canary11Direction.discoveryLanes.map((lane) => lane.laneId));
    for (const entry of plan) {
      const lane = canary11Direction.discoveryLanes.find((candidate) => candidate.laneId === entry.laneId);
      strictEqual(evaluateDiscoveryQueryQuality(entry.finalizedQuery, canary11Direction, lane).passes, true);
      for (const dimension of ["subject_entity", "geography", "subject_domain", "concrete_discovery_class", "evidence_orientation", "authority_preference", "lane_purpose"]) {
        ok(entry.semanticRequirements.some((requirement) => requirement.dimension === dimension), `${entry.laneId}: missing ${dimension}`);
      }
      for (const structured of ["periodTerms", "factTargets", "sourcePreferences"]) {
        if (lane[structured].length === 0) continue;
        const dimension = structured === "periodTerms" ? "historical_period" : structured === "factTargets" ? "fact_target" : "authority_preference";
        ok(entry.semanticRequirements.some((requirement) => requirement.dimension === dimension && requirement.compactTerms.length > 0), `${entry.laneId}: ${structured} not preserved`);
      }
    }
  });

  it("validates the frozen Direction and reaches the real materialized retrieval plan provider-free", async () => {
    const calls = [];
    const retrievals = [];
    const agent = createResearchAgent({
      config: {},
      now: () => new Date("2026-10-05T12:00:00.000Z"),
      execute: async (_context, request) => {
        calls.push(request);
        const direction = request.messages.some((message) => message.content.includes("Research Direction"));
        if (direction) return { output: canary11Direction, raw: "{}", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, model: "fixture", provider: "fixture", latencyMs: 0 };
        throw new Error("STOP_AFTER_PROVIDER_FREE_RETRIEVAL_PLAN");
      },
      capabilityExecution: { executeCapability: async (request) => {
        retrievals.push(request);
        return { status: "success", resultId: `result-${request.requestId}`, capabilityId: request.capabilityId, output: { providerId: "fixture", results: [] } };
      } },
    });
    const task = { id: "research-research", name: "Research", description: "Rosetta Stone discovery context", agent: "research", inputSchema: {}, outputSchema: {}, dependencies: [] };
    await rejects(agent.execute({
      context: { inputEvent: { workflow_id: "fixture-canary-11", correlation_id: "fixture-canary-11", event_id: "fixture-event" } },
      input: {
        task, contract: { taskId: task.id, stage: "research" }, synthesisContract: "amf-research-intelligence-v2",
        researchObjective: { projectId: "morroway", brand: "Morroway", contentPillar: "Historical POV", factualMode: "HISTORICAL_POV", platforms: ["youtube"], market: null, geography: "Egypt", language: "en", audience: "global curious adults", format: "vertical-short", businessObjective: "Rosetta Stone discovery context", topicConstraints: [], trendPreference: "HYBRID", desiredContentCount: 1, ownerConstraints: [] },
        capabilityInventory: canary11Direction.availableCapabilities,
      },
    }, { isCancelled: false, onCancelled() {}, throwIfCancelled() {} }), /STOP_AFTER_PROVIDER_FREE_RETRIEVAL_PLAN/);
    strictEqual(calls.length, 2);
    strictEqual(retrievals.length, 3);
    deepStrictEqual(retrievals.map((request) => request.input.laneId), canary11Direction.discoveryLanes.map((lane) => lane.laneId));
  });

  it("all canonical lane identities compile through the production retrieval-plan seam", () => {
    for (const laneId of CANONICAL_DISCOVERY_LANES) {
      const lane = {
        ...canary11Direction.discoveryLanes[0],
        laneId,
        purpose: lanePurpose[laneId],
        queryGuidance: `Rosetta Stone Fort Julien ${lanePurpose[laneId]} museum archive university sources evidence`,
      };
      const mission = { ...canary11Direction, discoveryLanes: [lane] };
      const plan = materializeDiscoveryRetrievalPlan(mission, scope, 1);
      strictEqual(plan.length, 1, laneId);
      strictEqual(evaluateDiscoveryQueryQuality(plan[0].finalizedQuery, mission, lane).passes, true, laneId);
    }
  });

  it("genuinely unrepresentable mandatory subject identity remains rejected", () => {
    const lane = {
      ...canary11Direction.discoveryLanes[0],
      laneId: "unrepresentable-subject",
      subjectTerms: ["x".repeat(220)],
      locationTerms: [],
    };
    const mission = { ...canary11Direction, geography: null, market: null, discoveryLanes: [lane] };
    throws(
      () => packWebSearchQuery(lane.queryGuidance, mission, lane),
      /LOCAL_QUERY_COMPILATION_FAILED:unrepresentable-subject:MANDATORY_SEMANTICS_DO_NOT_FIT:subject_entity/,
    );
  });
});

