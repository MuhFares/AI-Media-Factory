/**
 * Provider-free research quality + source-authority fixtures
 * (quality remediation V1). No network, no DB.
 *
 * Fixture domains exercise the deterministic authority classifier; they are
 * NOT production evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscoveryQueries,
  buildVerificationQuery,
  classifySourceAuthority,
  evaluateResearchEvidenceSufficiency,
  isGenericFactListQuery,
  reclassifyResearchEvidence,
  researchStatusForSufficiency,
} from "../dist/production-executor.js";

const QUIZ_5 = [
  { title: "Finding Evidence in Text Quiz - English Study Guide ...", url: "https://quizlet.com/826984233/x", snippet: "What textual evidence is typically found in informational text?", source: "quizlet.com" },
  { title: "Command of Textual Evidence Quizzes (SAT ...)", url: "https://www.quiz-tree.com/y", snippet: "Practice choosing the piece of evidence from a passage.", source: "quiz-tree.com" },
  { title: "Answer Explanations to the ACT 2025 Reading Practice Test", url: "https://www.piqosity.com/z", snippet: "Explanations to the full-length Reading test.", source: "piqosity.com" },
  { title: "What textual evidence is typically found ...", url: "https://brainly.com/q/1", snippet: "Facts that support the main idea.", source: "brainly.com" },
  { title: "English 9B Unit 10 Activity", url: "https://www.coursehero.com/f/1", snippet: "Argumentative and Research Writing activity.", source: "coursehero.com" },
];

const REDDIT_HISTORY = { title: "TIL about the Antikythera mechanism", url: "https://www.reddit.com/r/history/comments/abc/antikythera/", snippet: "Community discussion of the Antikythera mechanism discovery.", source: "reddit.com" };

const SI_QANAT = { title: "Qanat: Persian water management", url: "https://www.si.edu/spotlight/qanat-water", snippet: "Smithsonian survey of qanat tunnel systems in Iran with measured plans.", source: "si.edu" };
const BRITANNICA_QANAT = { title: "Qanat | irrigation | Britannica", url: "https://www.britannica.com/technology/qanat", snippet: "Qanat, ancient irrigation tunnel system of Iran with vertical shafts.", source: "britannica.com" };

const qanatCandidate = {
  candidateId: "candidate-1",
  topic: "Qanat water tunnels of Persia",
  factualAngle: "Two-millennia-old underground water engineering still in use",
  keyClaims: ["Qanat tunnels convey groundwater across arid Iran", "Vertical shafts and gentle gradients sustain flow"],
  sourceIds: [1, 2],
  supportingEvidenceIds: [1, 2],
  sourceQualitySummary: "Institutional survey plus reputable reference",
  visualPotential: "Underground tunnel cross-sections and shaft grids",
  shortFormPotential: "30-second reveal of hidden water engineering",
  evidenceRisks: ["Dating precision varies by site"],
  verificationStatus: "needs-verification",
};

test("authority classes classify deterministically", () => {
  assert.equal(classifySourceAuthority(SI_QANAT).authorityClass, "PRIMARY_OR_INSTITUTIONAL");
  assert.equal(classifySourceAuthority(BRITANNICA_QANAT).authorityClass, "REPUTABLE_SECONDARY");
  assert.equal(classifySourceAuthority({ title: "Some video", url: "https://www.youtube.com/watch?v=x", snippet: "A video" }).authorityClass, "GENERAL_MEDIA");
  assert.equal(classifySourceAuthority(REDDIT_HISTORY).authorityClass, "COMMUNITY");
  assert.equal(classifySourceAuthority(QUIZ_5[0]).authorityClass, "AGGREGATOR_OR_COMPILATION");
  assert.equal(classifySourceAuthority({ title: "Unknown", url: "https://example.test/x", snippet: "?" }).authorityClass, "UNKNOWN");
  assert.equal(classifySourceAuthority({ title: "250 Amazing FACTS That Will Blow Your MIND", url: "https://example.test/y", snippet: "facts" }).authorityClass, "AGGREGATOR_OR_COMPILATION");
  assert.equal(classifySourceAuthority({ title: "x", url: "https://www.nih.gov/health", snippet: "y" }).authorityClass, "PRIMARY_OR_INSTITUTIONAL");
});

test("A: compilation sources plus no candidates is INSUFFICIENT and not CEO-eligible", () => {
  const verdict = evaluateResearchEvidenceSufficiency({
    retrievalResults: QUIZ_5, synthesisSources: [], synthesisConfidence: 0, synthesisCitations: [], candidateStories: [],
  });
  assert.equal(verdict.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(verdict.ceoEligible, false);
  assert.equal(researchStatusForSufficiency(verdict), "INSUFFICIENT_EVIDENCE");
});

test("B: single Reddit-backed candidate needs verification", () => {
  const verdict = evaluateResearchEvidenceSufficiency({
    retrievalResults: [REDDIT_HISTORY],
    synthesisSources: [{ ...REDDIT_HISTORY, id: 1 }],
    synthesisConfidence: 0.4,
    synthesisCitations: [{ sourceId: 1, text: "Community discussion" }],
    candidateStories: [{ candidateId: "candidate-1", topic: "Antikythera mechanism", sourceIds: [1] }],
  });
  assert.equal(verdict.status, "NEEDS_VERIFICATION");
  assert.equal(verdict.ceoEligible, false);
});

test("C: institutional plus reputable sources make a viable candidate", () => {
  const sources = [{ ...SI_QANAT, id: 1 }, { ...BRITANNICA_QANAT, id: 2 }];
  const verdict = evaluateResearchEvidenceSufficiency({
    retrievalResults: [SI_QANAT, BRITANNICA_QANAT],
    synthesisSources: sources,
    synthesisConfidence: 0.8,
    synthesisCitations: [{ sourceId: 1, text: "Smithsonian survey" }, { sourceId: 2, text: "Britannica" }],
    candidateStories: [qanatCandidate],
  });
  assert.equal(verdict.status, "USABLE");
  assert.equal(verdict.ceoEligible, true);
  assert.equal(verdict.viableCandidates, 1);
  assert.equal(researchStatusForSufficiency(verdict), "USABLE");
});

test("D: citations without candidates is INSUFFICIENT", () => {
  const verdict = evaluateResearchEvidenceSufficiency({
    retrievalResults: [SI_QANAT, BRITANNICA_QANAT],
    synthesisSources: [SI_QANAT],
    synthesisConfidence: 0.5,
    synthesisCitations: [{ sourceId: 1, text: "Smithsonian survey" }],
    candidateStories: [],
  });
  assert.equal(verdict.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(verdict.ceoEligible, false);
});

test("E: low confidence plus insufficient status is never USABLE", () => {
  const verdict = evaluateResearchEvidenceSufficiency({
    retrievalResults: QUIZ_5, synthesisSources: [], synthesisConfidence: 0.06, synthesisCitations: [], candidateStories: [], synthesisStatus: "insufficient_evidence",
  });
  assert.equal(verdict.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(verdict.ceoEligible, false);
  assert.notEqual(researchStatusForSufficiency(verdict), "USABLE");
});

test("F: high confidence with an unsupported candidate is not USABLE", () => {
  const verdict = evaluateResearchEvidenceSufficiency({
    retrievalResults: [SI_QANAT],
    synthesisSources: [],
    synthesisConfidence: 0.9,
    synthesisCitations: [],
    candidateStories: [{ candidateId: "candidate-1", topic: "Unsupported claim", sourceIds: [] }],
  });
  assert.equal(verdict.status, "NEEDS_VERIFICATION");
  assert.equal(verdict.ceoEligible, false);
});

test("G: discovery queries aim at concrete candidates, never generic fact lists", () => {
  const queries = buildDiscoveryQueries({ brandProject: "morroway", audience: "curious adults" });
  assert.ok(queries.length >= 3);
  for (const query of queries) {
    assert.ok(query.length <= 160);
    assert.equal(isGenericFactListQuery(query), false);
  }
  const joined = queries.join(" ");
  assert.match(joined, /documented|archive|museum|university|scientific|experiment/i);
  assert.doesNotMatch(joined.toLowerCase(), /morroway/);
  assert.equal(isGenericFactListQuery("250 Amazing FACTS That Will Blow Your MIND"), true);
  assert.equal(isGenericFactListQuery("best stories of all time"), true);
  assert.equal(isGenericFactListQuery("Select the strongest evidence-grounded factual micro-story"), true);
});

test("H: verification queries target a concrete candidate with authority intent", () => {
  const query = buildVerificationQuery("Qanat water tunnels of Persia");
  assert.match(query, /Qanat water tunnels of Persia/);
  assert.match(query, /museum|university|archive|official|reference/i);
  assert.equal(isGenericFactListQuery(query), false);
  assert.throws(() => buildVerificationQuery("   "), /VERIFICATION_CANDIDATE_REQUIRED/);
});

test("pilot artifact reclassifies to COMPLETED execution with INSUFFICIENT evidence and no CEO eligibility", () => {
  const verdict = reclassifyResearchEvidence({
    sources: QUIZ_5.map((result, index) => ({ id: index + 1, title: result.title, url: result.url, snippet: result.snippet })),
    citations: [],
    confidence: 0.75,
    candidateStories: [],
  });
  assert.equal(verdict.executionStatus, "COMPLETED");
  assert.equal(verdict.evidenceStatus, "INSUFFICIENT_EVIDENCE");
  assert.equal(verdict.ceoEligible, false);
  assert.equal(verdict.candidateCount, 0);
  assert.equal(verdict.gateVersion, "amf-evidence-sufficiency-v1");
});
