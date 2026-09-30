/**
 * Canonical provider-free production fixtures shared by recovery E2Es.
 *
 * Runtime identity is copied from the real prompt assembled by the production
 * Research Agent.  The helper never supplies a competing identity and never
 * relaxes a production schema.
 */

export const canonicalResearchResults = [
  {
    title: "Ancient Egypt collection research",
    url: "https://whc.unesco.org/en/list/86/",
    snippet: "UNESCO documents the archaeological and historical context of Memphis and its necropolis in Egypt.",
    source: "unesco.org",
    rank: 1,
  },
  {
    title: "Egyptian art and archaeology",
    url: "https://www.britannica.com/place/ancient-Egypt",
    snippet: "Britannica provides an independently documented chronology and reference overview of ancient Egyptian history.",
    source: "britannica.com",
    rank: 2,
  },
];

function jsonStringAfter(prompt, label) {
  const line = prompt.split("\n").find((candidate) => candidate.includes(label));
  if (line === undefined) throw new Error(`Canonical fixture could not resolve ${label}`);
  const encoded = line.slice(line.indexOf(label) + label.length).trim();
  return JSON.parse(encoded);
}
function researchIdentity(prompt) {
  if (prompt.includes("Post-retrieval synthesis")) {
    return {
      taskId: jsonStringAfter(prompt, "Echo TASK_ID exactly into taskId:"),
      stage: jsonStringAfter(prompt, "Echo STAGE exactly into stage:"),
      taskDescription: "Production research for the requested content topic and audience.",
    };
  }
  const taskId = jsonStringAfter(prompt, "Contract taskId (echo EXACTLY into taskId, byte-for-byte, never paraphrased):");
  const stage = jsonStringAfter(prompt, "Contract stage (echo EXACTLY into stage):");
  const descriptionLine = prompt.split("\n").find((line) => line.startsWith("- Description: "));
  if (descriptionLine === undefined) throw new Error("Canonical fixture could not resolve Research description");
  return { taskId, stage, taskDescription: descriptionLine.slice("- Description: ".length) };
}

export function isResearchPrompt(prompt) {
  return prompt.includes("Contract taskId (echo EXACTLY") || prompt.includes("Post-retrieval synthesis");
}

export function canonicalResearchPayload(prompt) {
  const identity = researchIdentity(prompt);
  const base = {
    reportId: "00000000-0000-4000-8000-000000000301",
    ...identity,
    summary: "Canonical provider-free fixture for documented Egyptian history research.",
    sources: [],
    confidence: 0.2,
    citations: [],
    metadata: { createdAt: "2026-09-27T00:00:00.000Z", agentVersion: "fixture-v1" },
  };
  if (!prompt.includes("Post-retrieval synthesis")) return base;
  return {
    ...base,
    reportId: "00000000-0000-4000-8000-000000000302",
    summary: "Two institutional sources support a production candidate about documented Egyptian material history.",
    sources: canonicalResearchResults.map((row, index) => ({ id: index + 1, title: row.title, url: row.url, snippet: row.snippet })),
    confidence: 0.88,
    citations: canonicalResearchResults.map((row, index) => ({ sourceId: index + 1, text: row.snippet })),
    candidateStories: [{
      candidateId: "canonical-candidate-1",
      topic: "Documented Egyptian material history",
      factualAngle: "Institutional collections preserve evidence of Egyptian objects and their historical context.",
      keyClaims: ["Institutional collections document Egyptian objects and their historical context."],
      sourceIds: [1, 2],
      supportingEvidenceIds: [],
      sourceQualitySummary: "Two independent institutional museum sources.",
      visualPotential: "Museum objects and collection records.",
      shortFormPotential: "A concise object-led historical narrative.",
      evidenceRisks: [],
      verificationStatus: "verified",
    }],
    evidenceRisks: [],
    status: "grounded",
  };
}
