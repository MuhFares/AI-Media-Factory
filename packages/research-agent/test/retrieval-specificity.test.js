/** Provider-free retrieval-specificity suite: direction → compiler → query fidelity. No network. */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  materializeDiscoveryRetrievalPlan,
  finalizeWebSearchQuery,
  compileDiscoveryQuery,
  evaluateDiscoveryQueryQuality,
  diagnoseResearchStructure,
} from "../dist/index.js";

const SUBJECTS = [
  { slug: "nilometer", label: "Nilometer", entityTerms: ["nilometer", "rhoda"], guidance: "Search museum, archival, university, and reputable reference material on the Nilometer of Rhoda Island, Cairo, Abbasid-era water measurement, 861 CE construction. Exclude Bab Zuweila and prior-cycle topics." },
  { slug: "ibn-tulun", label: "Ibn Tulun Mosque", entityTerms: ["tulun"], guidance: "Search museum, archival, university, and reputable reference material on the Mosque of Ibn Tulun, Cairo, 876-879 CE Tulunid architecture, spiral minaret. Exclude Bab Zuweila and prior-cycle topics." },
  { slug: "sultan-hassan", label: "Mosque-Madrasa of Sultan Hassan", entityTerms: ["hassan"], guidance: "Search museum, archival, university, and reputable reference material on the Mosque-Madrasa of Sultan Hassan, Cairo, Mamluk 1356-1363 CE madrasa complex. Exclude Bab Zuweila and prior-cycle topics." },
  { slug: "al-azhar", label: "Al-Azhar historical development", entityTerms: ["azhar"], guidance: "Search museum, archival, university, and reputable reference material on Al-Azhar Mosque and university historical development, Fatimid 970 CE foundation, Cairo scholarship. Exclude Bab Zuweila and prior-cycle topics." },
  { slug: "geniza", label: "Cairo Geniza Ben Ezra context", entityTerms: ["geniza", "ezra"], guidance: "Search museum, archival, university, and reputable reference material on the Cairo Geniza, Ben Ezra Synagogue, Fustat documents, medieval community records. Exclude Bab Zuweila and prior-cycle topics." },
];

function missionFor(lanes) {
  return {
    missionId: "specificity-fixture", geography: "Cairo, Egypt", market: null, language: "en",
    factualMode: "HISTORICAL_POV", platforms: ["youtube"], contentPillar: "Historical POV",
    audience: "x", trendMode: "HYBRID", currentDate: "2026-10-03", discoveryLanes: lanes,
    desiredSourceTypes: ["Museum sources"],
    availableCapabilities: [{ sourceType: "WEB_SEARCH", status: "SUPPORTED", via: ["web.search"], limitations: [] }],
    unavailableDesiredCapabilities: [], searchPriorities: ["x"],
    verificationRequirements: ["Corroborate with museum, archive, university sources. Exclude Bab Zuweila and prior-cycle topics."],
    stopConditions: ["x"], riskNotes: [],
  };
}
const laneFor = (s) => ({
  laneId: s.slug, purpose: `Assess ${s.label} evidence`, queryGuidance: s.guidance,
  desiredCapability: "WEB_SEARCH", actualCapability: "web.search", maxCalls: 2, expectedOutput: "evidence set",
});
const scope = { workflowId: "wf-specificity", correlationId: "corr-specificity", taskId: "research-research" };
const DIMENSION_TERMS = ["cairo", "egypt", "history", "events", "people", "artifacts", "places", "sources", "evidence", "museum", "archive", "university", "discovery", "opportunities", "historical", "current", "relevance", "signals"];

describe("retrieval specificity: direction to query fidelity", () => {
  it("B+D. Cairo location and source-quality intent survive into every provider query", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      strictEqual(plan.length, 1);
      const q = plan[0].finalizedQuery.toLowerCase();
      ok(q.includes("cairo"), `${s.label}: Cairo missing`);
      for (const term of ["museum", "archive", "university"]) ok(q.includes(term), `${s.label}: ${term} missing`);
    }
  });

  it("F. provider queries never collapse below mission dimensions", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      const q = plan[0].finalizedQuery.toLowerCase();
      for (const term of ["cairo", "egypt", "history", "evidence"]) ok(q.includes(term), `${s.label}: dimension ${term} missing`);
      ok(q.length <= 200 && q.split(/\s+/).length >= 4);
    }
  });

  it("A+C. compact entity-bearing guidance keeps entity and period in the final query", () => {
    const mission = missionFor([{ laneId: "nilometer", purpose: "Assess Nilometer evidence", queryGuidance: "Nilometer Cairo Rhoda Island Abbasid water measurement museum sources", desiredCapability: "WEB_SEARCH", actualCapability: "web.search", maxCalls: 2, expectedOutput: "evidence" }]);
    const lane = mission.discoveryLanes[0];
    const compiled = compileDiscoveryQuery(lane.queryGuidance, mission, lane);
    const q = finalizeWebSearchQuery(compiled, mission, lane).toLowerCase();
    ok(q.includes("nilometer"), "entity stripped despite fitting");
    ok(q.includes("abbasid"), "period term stripped despite fitting");
    ok(q.length <= 200);
  });

  it("E. exclusions live in mission lineage and verification requirements, not query text", () => {
    const mission = missionFor([laneFor(SUBJECTS[0])]);
    ok(mission.verificationRequirements.join(" ").includes("Bab Zuweila"));
    ok(mission.discoveryLanes[0].queryGuidance.includes("Bab Zuweila"));
    const plan = materializeDiscoveryRetrievalPlan(mission, scope, 4);
    ok(!plan[0].finalizedQuery.toLowerCase().includes("zuweila"), "exclusions cannot be expressed in positive keyword queries");
  });

  it("G. intentionally broad direction still yields a broad discovery query", () => {
    const mission = missionFor([{ laneId: "general", purpose: "Survey the field", queryGuidance: "Cairo history museum sources", desiredCapability: "WEB_SEARCH", actualCapability: "web.search", maxCalls: 1, expectedOutput: "survey" }]);
    const plan = materializeDiscoveryRetrievalPlan(mission, scope, 4);
    strictEqual(plan.length, 1);
    ok(plan[0].finalizedQuery.toLowerCase().includes("cairo"));
  });

  it("fidelity matrix: long guidance rebuilds from dimensions and drops named entities", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      const q = plan[0].finalizedQuery.toLowerCase();
      const dropped = s.entityTerms.filter((t) => s.guidance.toLowerCase().includes(t) && !q.includes(t));
      ok(dropped.length > 0, `${s.label}: expected entity loss documented, got none`);
    }
    const identical = new Set(SUBJECTS.map((s) => materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4)[0].finalizedQuery));
    strictEqual(identical.size, 1, "documents that distinct subjects currently converge to one dimension query");
  });

  it("H+I. evidence validator unchanged; insufficient_evidence stays structurally valid", () => {
    const output = {
      reportId: "00000000-0000-4000-8000-000000000000", taskDescription: "Probe", summary: "Thin evidence.",
      candidateStories: [], sources: [{ id: 1, title: "T", url: "https://example.test/x", snippet: "S" }],
      confidence: 0.05, citations: [{ sourceId: 1, text: "S" }], evidenceRisks: ["thin"],
      status: "insufficient_evidence", metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
    };
    const input = { task: { id: "t", description: "Probe", name: "n", agent: "research", inputSchema: {}, outputSchema: {}, dependencies: [] } };
    deepStrictEqual(diagnoseResearchStructure(output, input).issues, []);
  });

  it("J. finalized queries introduce no novel named entities", () => {
    for (const s of SUBJECTS) {
      const mission = missionFor([laneFor(s)]);
      const plan = materializeDiscoveryRetrievalPlan(mission, scope, 4);
      const sourceText = JSON.stringify(mission).toLowerCase();
      const novel = plan[0].finalizedQuery.toLowerCase().split(/\s+/)
        .filter((w) => w.length >= 4 && !DIMENSION_TERMS.includes(w) && !sourceText.includes(w));
      deepStrictEqual(novel, [], `${s.label}: fabricated terms ${novel}`);
    }
  });
});
