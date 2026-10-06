// Frozen, bounded Canary-14 lineage fixture. This is regression evidence only:
// it contains the exact parsed candidate/source identities and the persisted
// retrieval lineage fields consumed by production normalization, without raw
// provider bodies or unrestricted snippets.
export const CANARY14_SYNTHESIS = {
  reportId: "123e4567-e89b-12d3-a456-426614174000",
  taskId: "research-research",
  stage: "research",
  taskDescription: "Production research for The ceremonial opening of the Suez Canal in 1869 at Port Said and Ismailia: Create one grounded Morroway Historical POV vertical short that places the viewer inside the documented 1869 opening of the Suez Canal, using only canonically retrieved evidence and stopping at Owner pre-media review before any media or publication.",
  summary: "The research mission focused on gathering authoritative, corroborated evidence for a single English-language Morroway Historical POV vertical short set during the Suez Canal’s 1869 opening events at Port Said and Ismailia. The discovery and verification processes yielded sufficient evidence to support one candidate story.",
  candidateStories: [{
    topic: "Inauguration Ceremony of the Suez Canal at Port-Said, 17 November, 1869",
    keyClaims: [
      "The Suez Canal was inaugurated on November 17, 1869",
      "The inauguration ceremony took place at Port Said",
      "Prominent attendees included Khedive Ismail, Empress Eugénie, and Ferdinand de Lesseps",
    ],
    sourceIds: [1, 2],
    candidateId: "candidate-1",
    factualAngle: "The Suez Canal was inaugurated on November 17, 1869, with a ceremony at Port Said. The event was attended by Khedive Ismail, Empress Eugénie, and Ferdinand de Lesseps, among other dignitaries. The ceremony marked the completion of the canal, which significantly reduced the distance between Europe and Asia.",
    evidenceRisks: ["The painting may not accurately depict the ceremony, as it was created in 1896, 27 years after the event"],
    visualPotential: "The painting from the Napoleon.org website provides a visual representation of the inauguration ceremony, which could be used to create engaging content.",
    shortFormPotential: "The key claims can be easily condensed into a short, informative narrative.",
    verificationStatus: "STRONG",
    factualVerification: { basis: "The key claims are supported by at least two independent, high-quality sources.", status: "STRONG" },
    sourceQualitySummary: "High-quality sources, including a painting from the Napoleon.org website and an official history from the Suez Canal Authority website.",
    supportingEvidenceIds: ["evidence-1", "evidence-2"],
    recommendedForProduction: true,
    contentOpportunityAssessment: { basis: "The Suez Canal's inauguration is a significant historical event with global relevance. The availability of high-quality visuals and concise key claims make this an excellent opportunity for a Morroway Historical POV vertical short.", level: "HIGH" },
  }],
  sources: [
    { id: 1, url: "https://www.napoleon.org/en/history-of-the-two-empires/paintings/inauguration-ceremony-of-the-suez-canal-at-port-said-17-november-1869/", title: "Inauguration Ceremony of the Suez Canal at Port-Said, 17 November, 1869", snippet: "Inauguration Ceremony of the Suez Canal at Port-Said, 17 November, 1869 ; Date : 1896 ; Technique : Oil on canvas ; Dimensions : H = 2,5 m, L = 3 m ; Place held : ..." },
    { id: 2, url: "https://www.suezcanal.gov.eg/English/About/SuezCanal/Pages/CanalHistory.aspx", title: "SCA - Canal History", snippet: "Suez Canal's actual history. Since its inauguration on the 17th of November 1869, its reopening in June of 1975. the inauguration ceremony on November 17th, ..." },
  ],
  confidence: 0.9,
  citations: [
    { text: "Inauguration Ceremony of the Suez Canal at Port-Said, 17 November, 1869", sourceId: 1 },
    { text: "Suez Canal's actual history. Since its inauguration on the 17th of November 1869, its reopening in June of 1975. the inauguration ceremony on November 17th, ...", sourceId: 2 },
  ],
  evidenceRisks: ["The painting may not accurately depict the ceremony, as it was created in 1896, 27 years after the event"],
  status: "grounded",
  metadata: { createdAt: "2026-10-06T13:19:51.825Z", agentVersion: "1.0.0" },
};

const execution = (role, lane, evidenceId, urls) => ({
  resultId: `web-search-result-research-capability-v2:wf-1791292736549-b0tsmjsx:initial:research-research:web.search:${role}:${lane}:q1:a1`,
  idempotencyKey: `web-search-result-research-capability-v2:wf-1791292736549-b0tsmjsx:initial:research-research:web.search:${role}:${lane}:q1:a1`,
  capabilityId: "web.search",
  status: "success",
  output: { providerId: "serper", results: urls.map((url) => ({ url })) },
  evidence: { evidenceId, succeeded: true, providerId: "serper", executedAt: "2026-10-06T13:19:51.825Z" },
});

export const CANARY14_CAPABILITY_EXECUTIONS = [
  execution("discovery", "ceremony-chronology-and-participants", "evidence-web-search-result-research-capability-v2:wf-1791292736549-b0tsmjsx:initial:research-research:web.search:discovery:ceremony-chronology-and-participants:q1:a1", [
    CANARY14_SYNTHESIS.sources[0].url,
    CANARY14_SYNTHESIS.sources[1].url,
    "https://www.facebook.com/ndaviral/posts/on-this-day-17-november-1869/",
    "https://photorientalist.org/exhibitions/the-suez-canal-celebrating-150-years-1869-2019/article/",
    "https://www.history.com/this-day-in-history/november-17/suez-canal-opens",
  ]),
  execution("discovery", "canal-and-event-context", "evidence-web-search-result-research-capability-v2:wf-1791292736549-b0tsmjsx:initial:research-research:web.search:discovery:canal-and-event-context:q2:a1", [
    "https://historyguesser.app/moments/suez-canal-opening-1869",
    "https://www.ebsco.com/research-starters/history/suez-canal-opens/",
    "https://maritimecyprus.com/2025/11/16/flashback-in-maritime-history-suez-canal-opens-to-the-world-17-november-1869/",
    CANARY14_SYNTHESIS.sources[1].url,
    "https://www.history.com/this-day-in-history/november-17/suez-canal-opens",
  ]),
  execution("verification", "verification-candidate-1", "evidence-web-search-result-research-capability-v2:wf-1791292736549-b0tsmjsx:initial:research-research:web.search:verification:verification-candidate-1:q1:a1", [
    "https://en.wikipedia.org/wiki/United_States_presidential_inauguration",
    "https://en.wikipedia.org/wiki/Second_inauguration_of_Donald_Trump",
    "https://www.usa.gov/inauguration",
    "https://www.merriam-webster.com/dictionary/inauguration",
    "https://constitutioncenter.org/blog/what-happens-on-inauguration-day",
  ]),
  execution("verification", "verification-candidate-2", "evidence-web-search-result-research-capability-v2:wf-1791292736549-b0tsmjsx:initial:research-research:web.search:verification:verification-candidate-2:q1:a1", [
    "https://www.facebook.com/scamuseum/posts/suez-canal-museum/",
    CANARY14_SYNTHESIS.sources[1].url,
    "https://www.facebook.com/friendsofegyptsupporttourismtoegypt/posts/soft-opening-of-the-suez-canal-museum/",
    "https://www.egypttoday.com/Article/1/131306/SCA-chief-Suez-Canal-Museum-to-preserve-document-canal-s",
    "https://sis.gov.eg/en/media-center/news/sca-chief-suez-canal-museum-to-preserve-document-canals-history/",
  ]),
];

export function canary14LineageInput() {
  return {
    ...structuredClone(CANARY14_SYNTHESIS),
    synthesisContract: "amf-research-intelligence-v2",
    researchPlan: { missionId: "mission-canary-14" },
    capabilityExecutions: structuredClone(CANARY14_CAPABILITY_EXECUTIONS),
  };
}
