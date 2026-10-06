// Frozen from persisted Canary-12 lifecycle/capability evidence. This fixture
// contains only the parsed synthesis and retrieval fields consumed by the
// production parser/evidence gate. It must never be used as live evidence.
export const CANARY12_SYNTHESIS = {
  reportId: "736674e8-488e-4452-8797-6789abcdef01",
  taskId: "research-research",
  stage: "research",
  taskDescription: "Production research for The medieval hospital of Sultan al-Mansur Qalawun in Cairo.",
  summary: "The Bimaristan al-Mansuri, established by Sultan al-Mansur Qalawun in the 1280s, was a significant healing institution within the Qalawun complex in Cairo.",
  sources: [
    { id: 1, title: "Qalawun complex - Wikipedia", url: "https://en.wikipedia.org/wiki/Qalawun_complex", snippet: "The Qalawun complex is a historic religious complex at Bayn al-Qasrayn in Islamic Cairo." },
    { id: 2, title: "Madrasa, Mausaleum, and Bimaristan of al-Mansur Qalawun", url: "https://egymonuments.gov.eg/en/monuments/madrasa-mausaleum-and-bimaristan-of-al-mansur-qalawun/", snippet: "Established in 683-684 AH/1283-1284 AD, the complex includes a hospital." },
    { id: 3, title: "Qalawun - Wikipedia", url: "https://en.wikipedia.org/wiki/Qalawun", snippet: "The Qalawun complex includes a mausoleum, madrasa, and maristan." },
  ],
  confidence: 0.95,
  citations: [
    { sourceId: 1, text: "The Qalawun complex is in Islamic Cairo." },
    { sourceId: 2, text: "The complex includes a hospital." },
    { sourceId: 3, text: "The complex includes a maristan." },
  ],
  candidateStories: [
    {
      candidateId: "candidate-1", topic: "Qalawun complex - Wikipedia",
      factualAngle: "The Qalawun complex is a historic religious complex in Islamic Cairo.",
      keyClaims: ["The Qalawun complex is a historic religious complex in Islamic Cairo."],
      sourceIds: [1],
      supportingEvidenceIds: ["evidence-web-search-result-research-capability-v2:wf-1791235222188-xmhegbx2:initial:research-research:web.search:verification:verification-candidate-1:q1:a1"],
      sourceQualitySummary: "Wikipedia summary.", visualPotential: "Architectural footage.", shortFormPotential: "A short reveal.",
      trendEvidence: [], evergreenEvidence: ["Historic site."], marketRelevance: "Global English-language audience.",
      recommendedForProduction: true,
    },
    {
      candidateId: "candidate-2", topic: "Madrasa, Mausaleum, and Bimaristan of al-Mansur Qalawun",
      factualAngle: "The complex was established in 1283-1284 AD and includes a hospital.",
      keyClaims: ["The complex was established in 1283-1284 AD.", "It includes a hospital."],
      sourceIds: [2], supportingEvidenceIds: [], sourceQualitySummary: "Egyptian Ministry source.",
      visualPotential: "Architectural elements.", shortFormPotential: "A 30-second explanation.", trendEvidence: [],
      evergreenEvidence: ["Historic landmark."], marketRelevance: "Global English-language audience.", recommendedForProduction: true,
    },
    {
      candidateId: "candidate-3", topic: "Qalawun - Wikipedia",
      factualAngle: "The Qalawun complex includes a mausoleum, madrasa, and hospital.",
      keyClaims: ["The complex includes a mausoleum, madrasa, and hospital."],
      sourceIds: [3], supportingEvidenceIds: [], sourceQualitySummary: "Wikipedia overview.",
      visualPotential: "Historic architecture.", shortFormPotential: "A short historical angle.", trendEvidence: [],
      evergreenEvidence: ["Historic site."], marketRelevance: "Global English-language audience.", recommendedForProduction: true,
    },
  ],
  evidenceRisks: [], status: "grounded",
  metadata: { createdAt: "2026-10-05T21:21:07.329Z", agentVersion: "1.0.0" },
};
export const CANARY12_RETRIEVAL_RESULTS = [
  { url: "https://en.wikipedia.org/wiki/Qalawun_complex", rank: 1, title: "Qalawun complex - Wikipedia", source: "en.wikipedia.org", snippet: "Historic religious complex in Islamic Cairo." },
  { url: "https://egymonuments.gov.eg/en/monuments/madrasa-mausaleum-and-bimaristan-of-al-mansur-qalawun/", rank: 2, title: "Madrasa, Mausaleum, and Bimaristan of al-Mansur Qalawun", source: "egymonuments.gov.eg", snippet: "The complex includes a hospital." },
  { url: "https://en.wikipedia.org/wiki/Qalawun", rank: 3, title: "Qalawun - Wikipedia", source: "en.wikipedia.org", snippet: "The complex includes a maristan." },
  { url: "https://www.ancient-history-sites.com/sites/al-mansour-qalawun-complex-madrassa-tomb-and-hospital/", rank: 4, title: "Al-Mansour Qalawun Complex", source: "ancient-history-sites.com", snippet: "Mamluk medical and funerary foundation." },
  { url: "https://www.academia.edu/5072462/Al_Bimāristān_al_Manṣūrī", rank: 5, title: "Al-Bimaristan al-Mansuri Explorations", source: "academia.edu", snippet: "Study of the early Mamluk hospital." },
  { url: "https://en.wikipedia.org/wiki/Qalawun_complex", rank: 1, title: "Qalawun complex", source: "en.wikipedia.org", snippet: "Includes a hospital, madrasa, mausoleum, and mosque." },
  { url: "https://en.wikipedia.org/wiki/Qalawun", rank: 2, title: "Qalawun", source: "en.wikipedia.org", snippet: "Bahri Mamluk sultan of Egypt." },
  { url: "https://historica.fandom.com/wiki/Qalawun_Complex", rank: 3, title: "Qalawun Complex", source: "historica.fandom.com", snippet: "A pious complex in Cairo." },
  { url: "https://www.egypttoursportal.com/en-us/blog/cairo-attractions/qalawun-complex/", rank: 4, title: "Qalawun Complex: History", source: "egypttoursportal.com", snippet: "Madrasa, hospital, and mausoleum." },
  { url: "https://commons.wikimedia.org/wiki/File:The_Qalawun_complex_(14608534510).jpg", rank: 5, title: "The Qalawun complex", source: "commons.wikimedia.org", snippet: "A Cairo complex including a hospital." },
];

export const CANARY12_TERMINAL = {
  researchStatus: "NEEDS_VERIFICATION",
  evidenceStatus: "NEEDS_VERIFICATION",
  ceoEligible: false,
  candidateCount: 3,
  viableCandidateCount: 0,
  reasons: ["CANDIDATE_NOT_RECOMMENDED_FOR_PRODUCTION", "CANDIDATE_NOT_RECOMMENDED_FOR_PRODUCTION", "CANDIDATE_NOT_RECOMMENDED_FOR_PRODUCTION"],
  workflowState: "FAILED",
  failureMessage: "AGENT_OUTPUT_BLOCKED:research",
  errorClassification: "LOCAL_EXECUTION_FAILED",
  synthesisReservationState: "FAILED_AFTER_SUBMISSION",
};
