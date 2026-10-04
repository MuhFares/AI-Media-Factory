/** Provider-free structured retrieval-intent suite: Direction terms survive into queries. No network. */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  materializeDiscoveryRetrievalPlan,
  finalizeWebSearchQuery,
  compileDiscoveryQuery,
  researchDirectionResponseSchema,
} from "../dist/index.js";

const SUBJECTS = [
  { slug: "nilometer", label: "Nilometer", terms: { subjectTerms: ["Nilometer", "Rhoda Island"], locationTerms: ["Cairo"], periodTerms: ["Abbasid", "861 CE"], factTargets: ["water measurement"], sourcePreferences: ["museum"] } },
  { slug: "ibn-tulun", label: "Ibn Tulun Mosque", terms: { subjectTerms: ["Ibn Tulun Mosque", "spiral minaret"], locationTerms: ["Cairo"], periodTerms: ["Tulunid", "876-879 CE"], factTargets: ["stucco decoration"], sourcePreferences: [] } },
  { slug: "sultan-hassan", label: "Mosque-Madrasa of Sultan Hassan", terms: { subjectTerms: ["Sultan Hassan", "madrasa"], locationTerms: ["Cairo"], periodTerms: ["Mamluk", "1356-1363 CE"], factTargets: ["mausoleum complex"], sourcePreferences: ["archive"] } },
  { slug: "al-azhar", label: "Al-Azhar historical development", terms: { subjectTerms: ["Al-Azhar"], locationTerms: ["Cairo"], periodTerms: ["Fatimid", "970 CE"], factTargets: ["religious scholarship"], sourcePreferences: [] } },
  { slug: "geniza", label: "Cairo Geniza Ben Ezra context", terms: { subjectTerms: ["Cairo Geniza", "Ben Ezra"], locationTerms: ["Fustat"], periodTerms: ["medieval"], factTargets: ["community records"], sourcePreferences: ["university"] } },
];
const GUIDANCE = "Search museum, archival, university, and reputable reference material on the subject. Identify a specific candidate and verify dating and context. Exclude Bab Zuweila and prior-cycle topics.";

function missionFor(lanes) {
  return {
    missionId: "intent-fixture", geography: "Cairo, Egypt", market: null, language: "en",
    factualMode: "HISTORICAL_POV", platforms: ["youtube"], contentPillar: "Historical POV",
    audience: "x", trendMode: "HYBRID", currentDate: "2026-10-03", discoveryLanes: lanes,
    desiredSourceTypes: ["Museum sources"],
    availableCapabilities: [{ sourceType: "WEB_SEARCH", status: "SUPPORTED", via: ["web.search"], limitations: [] }],
    unavailableDesiredCapabilities: [], searchPriorities: ["x"],
    verificationRequirements: ["Corroborate with museum, archive, university sources."],
    stopConditions: ["x"], riskNotes: [],
  };
}
const laneFor = (s) => ({
  laneId: s.slug, purpose: `Assess ${s.label} evidence`, queryGuidance: GUIDANCE,
  desiredCapability: "WEB_SEARCH", actualCapability: "web.search", maxCalls: 2, expectedOutput: "evidence set",
  ...s.terms,
});
const scope = { workflowId: "wf-intent", correlationId: "corr-intent", taskId: "research-research" };
const words = (q) => q.toLowerCase().split(/\s+/);

describe("structured retrieval intent", () => {
  it("A. structured subject survives Direction to query", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      strictEqual(plan.length, 1);
      const q = plan[0].finalizedQuery.toLowerCase();
      for (const term of s.terms.subjectTerms) {
        for (const word of term.toLowerCase().split(/\s+/)) ok(q.includes(word), `${s.label}: subject word ${word} missing from ${q}`);
      }
    }
  });

  it("B. location survives", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      const q = plan[0].finalizedQuery.toLowerCase();
      for (const term of s.terms.locationTerms) {
        for (const word of term.toLowerCase().split(/\s+/)) ok(q.includes(word), `${s.label}: location word ${word} missing`);
      }
    }
  });

  it("C. period survives where supplied", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      const q = plan[0].finalizedQuery.toLowerCase();
      ok(s.terms.periodTerms.some((t) => t.toLowerCase().split(/\s+/).every((w) => q.includes(w))), `${s.label}: no period term survived in ${q}`);
    }
  });

  it("D. fact target survives", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      const q = plan[0].finalizedQuery.toLowerCase();
      ok(s.terms.factTargets.some((t) => t.toLowerCase().split(/\s+/).every((w) => q.includes(w))), `${s.label}: no fact target survived in ${q}`);
    }
  });

  it("E. authority/source preference survives", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      const q = plan[0].finalizedQuery.toLowerCase();
      for (const term of ["museum", "archive", "university"]) ok(q.includes(term), `${s.label}: canonical authority ${term} missing`);
      for (const pref of s.terms.sourcePreferences) ok(q.includes(pref), `${s.label}: lane preference ${pref} missing`);
    }
  });

  it("F. compaction preserves structured subject under the length cap", () => {
    const s = SUBJECTS[0];
    const mission = missionFor([laneFor(s)]);
    const longGuidance = `${GUIDANCE} ${"Additional contextual prose about methods and historiography. ".repeat(10)}`;
    const lane = { ...mission.discoveryLanes[0], queryGuidance: longGuidance };
    ok(longGuidance.length > 200);
    const q = finalizeWebSearchQuery(compileDiscoveryQuery(longGuidance, mission, lane), mission, lane).toLowerCase();
    ok(q.length <= 200);
    ok(q.includes("nilometer"), `subject dropped under compaction: ${q}`);
  });

  it("G. five distinct subjects no longer collapse to the same generic query", () => {
    const queries = SUBJECTS.map((s) => materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4)[0].finalizedQuery);
    strictEqual(new Set(queries).size, SUBJECTS.length);
  });

  it("H. broad mission without terms still generates a valid broad discovery query", () => {
    const lane = { laneId: "general", purpose: "Survey the field", queryGuidance: "Cairo history museum sources", desiredCapability: "WEB_SEARCH", actualCapability: "web.search", maxCalls: 1, expectedOutput: "survey" };
    const plan = materializeDiscoveryRetrievalPlan(missionFor([lane]), scope, 4);
    strictEqual(plan.length, 1);
    ok(plan[0].finalizedQuery.toLowerCase().includes("cairo"));
  });

  it("I. retrieval count unchanged by structured intent", () => {
    const withTerms = materializeDiscoveryRetrievalPlan(missionFor(SUBJECTS.map(laneFor)), scope, 4);
    const bareLanes = SUBJECTS.map((s) => { const { subjectTerms: _a, locationTerms: _b, periodTerms: _c, factTargets: _d, sourcePreferences: _e, ...rest } = laneFor(s); return rest; });
    const withoutTerms = materializeDiscoveryRetrievalPlan(missionFor(bareLanes), scope, 4);
    strictEqual(withTerms.length, withoutTerms.length);
    strictEqual(withTerms.length, 3);
  });

  it("J. evidence validator unchanged (validator surface untouched)", async () => {
    const { diagnoseResearchStructure } = await import("../dist/index.js");
    const output = {
      reportId: "00000000-0000-4000-8000-000000000000", taskDescription: "Probe", summary: "Thin.",
      candidateStories: [], sources: [{ id: 1, title: "T", url: "https://example.test/x", snippet: "S" }],
      confidence: 0.05, citations: [{ sourceId: 1, text: "S" }], evidenceRisks: ["thin"],
      status: "insufficient_evidence", metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
    };
    const input = { task: { id: "t", description: "Probe", name: "n", agent: "research", inputSchema: {}, outputSchema: {}, dependencies: [] } };
    deepStrictEqual(diagnoseResearchStructure(output, input).issues, []);
  });

  it("K+L. empty terms stay valid and no candidate is fabricated from terms", () => {
    const bare = { laneId: "general", purpose: "Survey", queryGuidance: "Cairo history museum sources", desiredCapability: "WEB_SEARCH", actualCapability: "web.search", maxCalls: 1, expectedOutput: "survey" };
    const plan = materializeDiscoveryRetrievalPlan(missionFor([bare]), scope, 4);
    strictEqual(plan.length, 1);
    for (const s of SUBJECTS) {
      const q = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4)[0].finalizedQuery.toLowerCase();
      for (const token of ["recommended", "candidate-1", "production", "grounded"]) ok(!q.includes(token), `fabricated candidate language in ${q}`);
    }
  });

  it("M. exclusions are never introduced by term packing", () => {
    for (const s of SUBJECTS) {
      const plan = materializeDiscoveryRetrievalPlan(missionFor([laneFor(s)]), scope, 4);
      const q = plan[0].finalizedQuery.toLowerCase();
      ok(!q.includes("zuweila"), `excluded subject reintroduced in ${q}`);
    }
  });

  it("N. Direction provider schema has zero provider-risky keywords", () => {
    const schema = JSON.stringify(researchDirectionResponseSchema());
    for (const keyword of ['"oneOf"', '"anyOf"', '"const"', '"format"']) {
      ok(!schema.includes(keyword), `${keyword} present in Direction schema`);
    }
  });

  it("O. additionalProperties:false on all Direction schema objects", () => {
    const schema = researchDirectionResponseSchema();
    const missing = [];
    (function walk(node, path) {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
      if (node.type === "object") {
        if (node.additionalProperties !== false) missing.push(path);
        if (node.properties !== undefined) {
          for (const [key, value] of Object.entries(node.properties)) walk(value, `${path}.${key}`);
          return;
        }
      }
      for (const value of Object.values(node)) walk(value, path);
    })(schema, "$");
    deepStrictEqual(missing, []);
  });
});
