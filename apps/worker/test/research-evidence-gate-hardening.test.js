/**
 * Provider-free unit tests for Research evidence-gate hardening
 * (AMF_RESEARCH_EVIDENCE_GATE_AND_SYNTHESIS_LIFECYCLE_HARDENING_V1).
 *
 * No DB, no network, no provider calls. Covers:
 * - Canary-09-style gate replay fixture (retrieval success + empty synthesis
 *   deterministically blocks with contract reasons),
 * - buildResearchBlockedDiagnostics bounded shape (Part B2/B3),
 * - safeValidationDiagnostics researchBlocked pass-through + bounding,
 * - deriveCallTransportState submission-lifecycle matrix (Part C2 states).
 */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  classifySourceAuthority,
  evaluateResearchEvidenceQuality,
  evaluateResearchEvidenceSufficiency,
  buildResearchBlockedDiagnostics,
  boundResearchBlockedDiagnostics,
  safeValidationDiagnostics,
  deriveCallTransportState,
} from "../dist/production-executor.js";

// Historical evidence contract for certification closure. The old Canary-09
// runtime did not durably retain the exact Nemo synthesis payload. This
// provider-free fixture is therefore a regression reproduction of that
// failure class, never a reconstruction or claim about the missing response.
const CANARY09_HISTORICAL_LIMITATION = Object.freeze({
  synthesisPayload: "NON_RECOVERABLE",
  exactGateReasons: "NOT_PROVABLE",
  mirrorClassification: "REGRESSION_ONLY",
});

it("classifies the Canary-09 mirror as regression-only because exact historical synthesis is unavailable", () => {
  deepStrictEqual(CANARY09_HISTORICAL_LIMITATION, {
    synthesisPayload: "NON_RECOVERABLE",
    exactGateReasons: "NOT_PROVABLE",
    mirrorClassification: "REGRESSION_ONLY",
  });
});

// Small deterministic fixture mirroring the Canary-09 retrieval authority mix:
// institutional (.edu / .gov), general media, community, and unknowns.
const GATE_FIXTURE_RESULTS = [
  { title: "University survey of the Step Pyramid complex", url: "https://www.memphis.edu/egypt/resources/saqqara.php", snippet: "Measured survey of the enclosure and courts.", source: "memphis.edu" },
  { title: "Step Pyramid complex research article", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000000/", snippet: "Peer-reviewed analysis of construction sequence.", source: "pmc" },
  { title: "Documentary footage of Saqqara", url: "https://www.youtube.com/watch?v=fixture001", snippet: "Video walkthrough of the complex.", source: "youtube.com" },
  { title: "Discussion thread about Saqqara", url: "https://www.facebook.com/posts/fixture002", snippet: "Visitor photos and comments.", source: "facebook.com" },
  { title: "Step Pyramid complex overview", url: "https://smarthistory.org/step-pyramid-complex-saqqara/", snippet: "Art-historical overview of the complex.", source: "smarthistory.org" },
  { title: "Saqqara field notes", url: "https://arce.org/resource/saqqara/", snippet: "Research center resource page.", source: "arce.org" },
];

const webSearchExecutions = (count) => Array.from({ length: count }, (_, index) => ({
  resultId: `web-search-result-fixture-${index}`,
  capabilityId: "web.search",
  status: "success",
}));

const groundedOutput = (overrides = {}) => ({
  researchPlan: { missionId: "mission-fixture" },
  capabilityExecutions: webSearchExecutions(4),
  sources: [
    { id: 1, title: "A", url: "https://www.memphis.edu/egypt/a", snippet: "a" },
    { id: 2, title: "B", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC0000000/", snippet: "b" },
  ],
  citations: [{ sourceId: 1, text: "a" }],
  confidence: 0.3,
  candidateStories: [],
  status: "insufficient_evidence",
  evidenceQuality: {
    retrievalCount: 20,
    retrievalQuality: "RELEVANT",
    synthesisConfidence: 0.3,
    synthesisSourceCount: 2,
    status: "INSUFFICIENT_EVIDENCE",
    evidenceStatus: "INSUFFICIENT_EVIDENCE",
    ceoEligible: false,
    authorityBreakdown: {
      PRIMARY_OR_INSTITUTIONAL: 5, REPUTABLE_SECONDARY: 0, GENERAL_MEDIA: 1,
      COMMUNITY: 2, AGGREGATOR_OR_COMPILATION: 0, UNKNOWN: 12,
    },
    candidateCount: 0,
    viableCandidates: 0,
    sufficiencyReasons: ["NO_CANDIDATE_STORIES"],
  },
  synthesisUsage: {},
  researchStatus: "INSUFFICIENT_EVIDENCE",
  ...overrides,
});

describe("canary-09-style evidence gate replay (provider-free)", () => {
  it("retrieval success plus empty synthesis deterministically blocks with contract reasons", () => {
    const quality = evaluateResearchEvidenceQuality({
      retrievalResults: GATE_FIXTURE_RESULTS,
      synthesisSources: [],
      synthesisConfidence: null,
      synthesisCitations: [],
    });
    strictEqual(quality.retrievalQuality, "RELEVANT");
    strictEqual(quality.status, "NEEDS_RESEARCH_RETRY");
    ok(quality.reasons.includes("SYNTHESIS_SOURCES_EMPTY"));

    const sufficiency = evaluateResearchEvidenceSufficiency({
      retrievalResults: GATE_FIXTURE_RESULTS,
      synthesisSources: [],
      synthesisConfidence: null,
      synthesisCitations: [],
      candidateStories: [],
      synthesisStatus: undefined,
    });
    strictEqual(sufficiency.ceoEligible, false);
    ok(sufficiency.reasons.includes("NO_CANDIDATE_STORIES"));
  });

  it("institutional retrieval alone never implies ceoEligible without viable candidates", () => {
    const classes = GATE_FIXTURE_RESULTS.map(classifySourceAuthority);
    ok(classes.some((entry) => entry.authorityClass === "PRIMARY_OR_INSTITUTIONAL"));
    const sufficiency = evaluateResearchEvidenceSufficiency({
      retrievalResults: GATE_FIXTURE_RESULTS,
      synthesisSources: [],
      synthesisConfidence: null,
      synthesisCitations: [],
      candidateStories: [],
      synthesisStatus: undefined,
    });
    strictEqual(sufficiency.ceoEligible, false);
    strictEqual(sufficiency.viableCandidates, 0);
  });
});

describe("buildResearchBlockedDiagnostics (bounded, no raw evidence)", () => {
  it("retains the gate verdict and counts for an empty-synthesis block", () => {
    const diagnostics = buildResearchBlockedDiagnostics(groundedOutput(), { projectId: "morroway" }, "research");
    strictEqual(diagnostics.ceoEligible, false);
    strictEqual(diagnostics.evidenceQualityStatus, "INSUFFICIENT_EVIDENCE");
    strictEqual(diagnostics.evidenceStatus, "INSUFFICIENT_EVIDENCE");
    strictEqual(diagnostics.retrievalCount, 20);
    strictEqual(diagnostics.evidenceRecordCount, 4);
    strictEqual(diagnostics.uniqueSourceUrlCount, 2);
    strictEqual(diagnostics.candidateCount, 0);
    strictEqual(diagnostics.viableCandidateCount, 0);
    strictEqual(diagnostics.synthesisEligibility, "NOT_SUBMITTED");
    strictEqual(diagnostics.synthesisSubmitted, false);
    deepStrictEqual(diagnostics.authorityBreakdown, {
      PRIMARY_OR_INSTITUTIONAL: 5, REPUTABLE_SECONDARY: 0, GENERAL_MEDIA: 1,
      COMMUNITY: 2, AGGREGATOR_OR_COMPILATION: 0, UNKNOWN: 12,
    });
    ok(diagnostics.failedGatePaths.includes("evidenceQuality.ceoEligible"));
    ok(diagnostics.failedGatePaths.includes("candidateStories"));
    ok(diagnostics.sufficiencyReasons.includes("NO_CANDIDATE_STORIES"));
    // No raw evidence text may survive: titles, URLs, snippets are counts only.
    const serialized = JSON.stringify(diagnostics);
    strictEqual(serialized.includes("memphis.edu"), false);
    strictEqual(serialized.includes("Measured survey"), false);
  });

  it("detects a submitted synthesis via synthesisUsage and absent retrieval", () => {
    const submitted = buildResearchBlockedDiagnostics(
      groundedOutput({ synthesisUsage: { inputTokens: 10, outputTokens: 20, costUsd: 0.00002 }, capabilityExecutions: [] }),
      {},
      "research",
    );
    strictEqual(submitted.synthesisEligibility, "SUBMITTED");
    strictEqual(submitted.synthesisSubmitted, true);
    strictEqual(submitted.researchBlockReason, "RESEARCH_RETRIEVAL_ABSENT");
    strictEqual(submitted.evidenceRecordCount, 0);
    ok(submitted.failedGatePaths.includes("capabilityExecutions.web.search"));
  });

  it("marks NEEDS_RESEARCH_RETRY quality distinctly", () => {
    const diagnostics = buildResearchBlockedDiagnostics(
      groundedOutput({ evidenceQuality: { ...groundedOutput().evidenceQuality, status: "NEEDS_RESEARCH_RETRY" } }),
      {},
      "research",
    );
    strictEqual(diagnostics.researchBlockReason, "EVIDENCE_QUALITY_NEEDS_RESEARCH_RETRY");
    ok(diagnostics.failedGatePaths.includes("evidenceQuality.status"));
  });

  it("bounds hostile inputs and never mutates the report", () => {
    const hostile = groundedOutput({
      evidenceQuality: {
        retrievalCount: -5,
        status: "X".repeat(500),
        ceoEligible: "yes",
        sufficiencyReasons: Array.from({ length: 50 }, (_, index) => `R${index}_`.padEnd(200, "Z")),
        reasons: "not-an-array",
        authorityBreakdown: { PRIMARY_OR_INSTITUTIONAL: 3, HACKED: 99, UNKNOWN: -1 },
        candidateCount: 2.5,
        viableCandidates: Number.NaN,
      },
    });
    const before = JSON.stringify(hostile);
    const diagnostics = buildResearchBlockedDiagnostics(hostile, {}, "research");
    strictEqual(JSON.stringify(hostile), before);
    strictEqual(diagnostics.retrievalCount, 0);
    strictEqual(diagnostics.sufficiencyReasons.length, 20);
    ok(diagnostics.sufficiencyReasons.every((entry) => entry.length <= 120));
    strictEqual(diagnostics.failedGatePaths.length <= 8, true);
    deepStrictEqual(diagnostics.authorityBreakdown, {
      PRIMARY_OR_INSTITUTIONAL: 3, REPUTABLE_SECONDARY: 0, GENERAL_MEDIA: 0,
      COMMUNITY: 0, AGGREGATOR_OR_COMPILATION: 0, UNKNOWN: 0,
    });
    strictEqual(diagnostics.candidateCount, 0);
    strictEqual(diagnostics.viableCandidateCount, 0);
  });

  it("boundResearchBlockedDiagnostics admits only the allowlisted shape", () => {
    const bounded = boundResearchBlockedDiagnostics({
      researchBlockReason: "EVIDENCE_GATE_NOT_CEO_ELIGIBLE",
      ceoEligible: false,
      extraSecret: "must not survive",
      authorityBreakdown: { PRIMARY_OR_INSTITUTIONAL: 2 },
      synthesisSubmitted: true,
      synthesisEligibility: "SUBMITTED",
    });
    strictEqual(bounded.researchBlockReason, "EVIDENCE_GATE_NOT_CEO_ELIGIBLE");
    strictEqual("extraSecret" in bounded, false);
    strictEqual(bounded.synthesisSubmitted, true);
  });

  it("rejects secrets, URLs, and prose even when injected into allowlisted diagnostic fields", () => {
    const sensitive = "authorization=Bearer-super-secret";
    const bounded = boundResearchBlockedDiagnostics({
      researchBlockReason: sensitive,
      evidenceQualityStatus: "https://sensitive.example/private",
      evidenceStatus: "token=hidden",
      sufficiencyReasons: [sensitive, "NO_CANDIDATE_STORIES"],
      insufficiencyReasons: ["https://sensitive.example/raw", "SYNTHESIS_SOURCES_EMPTY"],
      failedGatePaths: ["https://sensitive.example/path", "evidenceQuality.ceoEligible"],
      synthesisEligibility: sensitive,
    });
    const serialized = JSON.stringify(bounded);
    strictEqual(serialized.includes("super-secret"), false);
    strictEqual(serialized.includes("sensitive.example"), false);
    strictEqual(serialized.includes("token=hidden"), false);
    strictEqual(bounded.researchBlockReason, "RESEARCH_EVIDENCE_GATE_BLOCKED");
    deepStrictEqual(bounded.sufficiencyReasons, ["NO_CANDIDATE_STORIES"]);
    deepStrictEqual(bounded.insufficiencyReasons, ["SYNTHESIS_SOURCES_EMPTY"]);
    deepStrictEqual(bounded.failedGatePaths, ["evidenceQuality.ceoEligible"]);
    strictEqual(bounded.synthesisEligibility, "UNKNOWN");
  });
});

describe("safeValidationDiagnostics researchBlocked pass-through", () => {
  it("preserves bounded blocked diagnostics on the thrown blocked error", () => {
    const error = new Error("AGENT_OUTPUT_BLOCKED:research");
    error.diagnostics = {
      researchBlocked: {
        ...buildResearchBlockedDiagnostics(groundedOutput(), {}, "research"),
        extraSecret: "must be stripped",
      },
    };
    const details = safeValidationDiagnostics(error);
    strictEqual(details.researchBlocked.researchBlockReason, "EVIDENCE_GATE_NOT_CEO_ELIGIBLE");
    strictEqual(details.researchBlocked.ceoEligible, false);
    strictEqual("extraSecret" in details.researchBlocked, false);
  });

  it("leaves unrelated errors untouched", () => {
    deepStrictEqual(safeValidationDiagnostics(new Error("boom")), {});
  });
});

describe("deriveCallTransportState submission matrix", () => {
  const reservation = (status) => ({ reservationId: "res-1", idempotencyKey: "idem-1", status });
  const event = (state, meta = {}) => ({ metadata: { reservationId: "res-1", idempotencyKey: "idem-1", ...meta }, state });

  it("pre-submission states never imply submission", () => {
    strictEqual(deriveCallTransportState(reservation("RESERVED"), []), "RESERVED");
    strictEqual(deriveCallTransportState(reservation("RESERVED"), [event("PROVIDER_SUBMISSION_INTENT")]), "RESERVED");
  });

  it("fetch start proves submission even without a response", () => {
    strictEqual(deriveCallTransportState(reservation("RESERVED"), [event("FETCH_INVOCATION_STARTED")]), "TRANSPORT_STARTED");
  });

  it("provider response completes the transport", () => {
    strictEqual(
      deriveCallTransportState(reservation("RESERVED"), [event("FETCH_INVOCATION_STARTED"), event("PROVIDER_RESPONSE_RECEIVED")]),
      "TRANSPORT_COMPLETED",
    );
  });

  it("failure after start is a submitted failure, never a release", () => {
    strictEqual(
      deriveCallTransportState(reservation("RESERVED"), [event("FETCH_INVOCATION_STARTED"), event("FAILED")]),
      "TRANSPORT_FAILED_AFTER_START",
    );
  });

  it("ignores events for other reservations", () => {
    strictEqual(
      deriveCallTransportState(reservation("RESERVED"), [{ metadata: { reservationId: "res-2", idempotencyKey: "idem-2" }, state: "FETCH_INVOCATION_STARTED" }]),
      "RESERVED",
    );
  });
});
