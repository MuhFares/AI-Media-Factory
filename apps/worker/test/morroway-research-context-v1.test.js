/** Provider-free Morroway research context + evidence-gate fixtures (task V1 remediation). No network, no DB. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductionResearchSearchQuery,
  evaluateResearchEvidenceQuality,
  groundResearchReport,
  requireMorrowayResearchProjectContext,
  sanitizedFailureMessage,
} from "../dist/production-executor.js";
import { resolveApprovedProjectContext } from "../dist/project-context.js";

const QUIZ_RESULTS = [
  { title: "Finding Evidence in Text Quiz - English Study Guide ...", url: "https://quizlet.com/826984233/x", snippet: "What textual evidence is typically found in informational text?", source: "quizlet.com" },
  { title: "Command of Textual Evidence Quizzes (SAT ...)", url: "https://www.quiz-tree.com/y", snippet: "Practice choosing the piece of evidence from a passage.", source: "quiz-tree.com" },
  { title: "Answer Explanations to the ACT 2025 Reading Practice Test", url: "https://www.piqosity.com/z", snippet: "Explanations to the full-length Reading test.", source: "piqosity.com" },
  { title: "What textual evidence is typically found ...", url: "https://brainly.com/q/1", snippet: "Facts that support the main idea.", source: "brainly.com" },
  { title: "English 9B Unit 10 Activity", url: "https://www.coursehero.com/f/1", snippet: "Argumentative and Research Writing activity.", source: "coursehero.com" },
];

const FACTUAL_RESULTS = [
  { title: "Qanat: ancient Persian water tunnels still in use", url: "https://example.test/qanat-persia", snippet: "Archaeologists document qanat tunnels in Iran supplying villages for two millennia.", source: "example.test" },
  { title: "Nubian vault: mud-brick roofing without timber", url: "https://example.test/nubian-vault", snippet: "Field survey records Nubian vault construction across Upper Egypt and Sudan.", source: "example.test" },
  { title: "Stepwells of Gujarat: monsoon water architecture", url: "https://example.test/stepwells", snippet: "Conservation report lists dated stepwell inscriptions and measured depths.", source: "example.test" },
];

const groundedSynthesis = {
  reportId: "11111111-1111-4111-8111-111111111111",
  taskId: "research-research",
  stage: "research",
  taskDescription: "Production research for candidate factual stories for the Morroway pilot.",
  summary: "Three dated candidates with field-survey provenance.",
  sources: [{ id: 1, title: FACTUAL_RESULTS[0].title, url: FACTUAL_RESULTS[0].url, snippet: FACTUAL_RESULTS[0].snippet }],
  confidence: 0.8,
  citations: [{ sourceId: 1, text: FACTUAL_RESULTS[0].snippet.slice(0, 40) }],
  metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
};

const withSearch = (synthesis, results) => ({
  ...synthesis,
  capabilityExecutions: [{
    status: "success",
    capabilityId: "web.search",
    output: { results },
    evidence: { providerId: "serper", evidenceId: "evidence-1", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z" },
  }],
});

test("failure messages persist bounded and secret-safe for diagnoseless failures", () => {
  assert.equal(sanitizedFailureMessage(new Error("Research requires the initial content plan artifact")), "Research requires the initial content plan artifact");
  assert.equal(sanitizedFailureMessage(new Error("x".repeat(900))).length, 500);
  assert.match(sanitizedFailureMessage(new Error("denied: api_key=supersecretvalue123")), /\[REDACTED\]/);
  assert.doesNotMatch(sanitizedFailureMessage(new Error("denied: api_key=supersecretvalue123")), /supersecretvalue123/);
});

test("G: missing Morroway context fails closed with PROJECT_CONTEXT_INCOMPLETE", async () => {
  await assert.rejects(async () => requireMorrowayResearchProjectContext({}), /PROJECT_CONTEXT_INCOMPLETE:brand/);
  await assert.rejects(
    async () => requireMorrowayResearchProjectContext({ brand: "Morroway", contentPillars: ["only one"], positioning: "x", prohibitions: ["y"] }),
    /PROJECT_CONTEXT_INCOMPLETE/,
  );
});

test("H: canonical Morroway context loads with provenance and drives a factual-candidate query", () => {
  const context = requireMorrowayResearchProjectContext(resolveApprovedProjectContext("morroway", { artifactRefs: [] }));
  assert.equal(context.brand, "Morroway");
  assert.ok(context.contentPillars.some((pillar) => /historical/i.test(String(pillar))));
  assert.ok(context.contentPillars.some((pillar) => /fantasy/i.test(String(pillar))));
  assert.ok(String(context.positioning).length > 0);
  assert.ok(Array.isArray(context.prohibitions) && context.prohibitions.length > 0);
  const query = buildProductionResearchSearchQuery({
    contentTopic: "Select the strongest evidence-grounded factual micro-story for Morroway Pilot 1",
    objective: "Use Morroway strategy, brand context, governed retrieval, and executive reasoning to choose and develop one genuinely publishable first factual YouTube Short.",
    brandProject: "morroway",
    audience: "curious adults",
    platform: "youtube",
  });
  assert.match(query, /Morroway/i);
  assert.match(query, /candidate/i);
  assert.match(query, /factual/i);
  assert.doesNotMatch(query.toLowerCase(), /textual evidence/);
  assert.doesNotMatch(query.toLowerCase(), /strongest evidence/);
  assert.doesNotMatch(query.toLowerCase(), /micro-story/);
});

test("I: off-topic quiz sources plus empty synthesis need a research retry", () => {
  const evaluation = evaluateResearchEvidenceQuality({ retrievalResults: QUIZ_RESULTS, synthesisSources: [], synthesisConfidence: 0, synthesisCitations: [] });
  assert.equal(evaluation.status, "NEEDS_RESEARCH_RETRY");
  assert.equal(evaluation.retrievalQuality, "OFF_TOPIC");
  const grounded = groundResearchReport(withSearch({ ...groundedSynthesis, sources: [], citations: [], confidence: 0, summary: "No evidence yet." }, QUIZ_RESULTS));
  assert.equal(grounded.researchStatus, "NEEDS_RESEARCH_RETRY");
  assert.equal(grounded.confidence, 0);
});

test("J: relevant sources with grounded citations are USABLE for CEO consumption", () => {
  const evaluation = evaluateResearchEvidenceQuality({ retrievalResults: FACTUAL_RESULTS, synthesisSources: groundedSynthesis.sources, synthesisConfidence: groundedSynthesis.confidence, synthesisCitations: groundedSynthesis.citations });
  assert.equal(evaluation.status, "USABLE");
  const grounded = groundResearchReport(withSearch(groundedSynthesis, FACTUAL_RESULTS));
  assert.equal(grounded.researchStatus, "USABLE");
  assert.equal(grounded.confidence, 0.8);
});
