import { describe, it } from "node:test";
import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import { buildVerificationQueryFor, compileDiscoveryQuery, createResearchAgent, evaluateDiscoveryQueryQuality, finalizeWebSearchQuery, materializeDiscoveryRetrievalPlan, normalizeRuntimeIdentityEchoes, packWebSearchQuery } from "../dist/index.js";
import { WEB_SEARCH_MAX_QUERY_LENGTH } from "@ai-media-factory/tool-framework";

const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };
const task = { id: "research-v2", name: "Research", description: "Find evidence-grounded short-form opportunities.", agent: "research", inputSchema: {}, outputSchema: {}, dependencies: [] };
const context = { inputEvent: { workflow_id: "wf-v2", correlation_id: "corr-v2", event_id: "ev-v2" } };
const inventory = [
  { sourceType: "WEB_SEARCH", status: "SUPPORTED", via: ["web.search"], limitations: [] },
  { sourceType: "INSTAGRAM_DISCOVERY", status: "UNSUPPORTED", via: [], limitations: ["No governed connector"] },
];

function mission(factualMode = "HISTORICAL_POV") {
  return {
    taskId: task.id, stage: "research", missionId: "mission-1", objective: "Egyptian Arabic audience opportunities",
    market: "Egypt", geography: "Egypt", language: "Arabic", platforms: ["YouTube Shorts", "Instagram"],
    contentPillar: factualMode === "HISTORICAL_POV" ? "Historical POV" : "Original AI Fantasy", factualMode,
    audience: "Egyptian Arabic audience", trendMode: "HYBRID", timeHorizon: { from: null, to: null }, currentDate: "2026-09-25",
    discoveryLanes: [
      { laneId: "HISTORICAL_OPPORTUNITY", purpose: "Find named opportunities", queryGuidance: "Egypt museum unusual documented object", desiredCapability: "WEB_SEARCH", actualCapability: "web.search", maxCalls: 1, expectedOutput: "sources" },
      { laneId: "SOCIAL_CONTENT_SIGNAL", purpose: "Check Instagram interest", queryGuidance: "Egypt history reels", desiredCapability: "INSTAGRAM_DISCOVERY", actualCapability: "social.discovery", maxCalls: 1, expectedOutput: "signals" },
    ],
    desiredSourceTypes: ["WEB_SEARCH", "INSTAGRAM_DISCOVERY"], availableCapabilities: inventory,
    unavailableDesiredCapabilities: [], searchPriorities: ["named topics"], verificationRequirements: ["institutional corroboration"], stopConditions: ["bounded calls"], riskNotes: [],
  };
}

function report({ factualMode = "HISTORICAL_POV", opportunity = "HIGH", factual = "INCOMPLETE", recommended = true } = {}) {
  return {
    reportId: "11111111-1111-4111-8111-111111111111", taskId: task.id, stage: "research",
    taskDescription: "Evidence-grounded synthesis for short-form opportunities.", summary: "Candidate synthesis.",
    candidateStories: [{ candidateId: "candidate-1", topic: "Documented object", factualAngle: "A museum object", keyClaims: ["Claim"], sourceIds: [1], supportingEvidenceIds: ["d1"], sourceQualitySummary: "One source", visualPotential: "High", shortFormPotential: "High", evidenceRisks: ["Needs corroboration"], verificationStatus: factual, contentOpportunityAssessment: { level: opportunity, basis: "Discovery signal" }, factualVerification: { status: factual, basis: "Verification evidence" }, recommendedForProduction: recommended }],
    sources: [{ id: 1, title: "Museum source", url: "https://museum.example/object", snippet: "Documented object." }], confidence: .7,
    citations: [{ sourceId: 1, text: "Documented object." }], evidenceRisks: [], status: "grounded", metadata: { createdAt: "2026-09-25T00:00:00Z", agentVersion: `v2-${factualMode}` },
  };
}

function input(factualMode = "HISTORICAL_POV") {
  return { task, contract: { taskId: task.id, stage: "research" }, synthesisContract: "amf-research-intelligence-v2", researchObjective: { projectId: "morroway", brand: "Morroway", contentPillar: factualMode === "HISTORICAL_POV" ? "Historical POV" : "Original AI Fantasy", factualMode, platforms: ["YouTube Shorts"], market: "Egypt", language: "Arabic", audience: "Egyptian Arabic audience", format: "vertical-short", businessObjective: "Find viable ideas", topicConstraints: [], trendPreference: "HYBRID", desiredContentCount: 3, ownerConstraints: [] }, capabilityInventory: inventory };
}

function agentFor(finalReport, calls, capabilityCalls) {
  return createResearchAgent({ config: {}, execute: async (_ctx, request) => {
    const text = request.messages.map((m) => m.content).join("\n"); calls.push(text);
    return { output: text.includes("Research Direction") ? mission(finalReport.metadata.agentVersion.includes("ORIGINAL_FANTASY") ? "ORIGINAL_FANTASY" : "HISTORICAL_POV") : finalReport, raw: "{}", usage: { inputTokens: 10, outputTokens: 10, costUsd: .001 }, model: "fixture", provider: "fixture", latencyMs: 1 };
  }, capabilityExecution: { executeCapability: async (request) => {
    capabilityCalls.push(request);
    const verification = String(request.requestId).includes(":verify-");
    return { status: "success", capabilityId: "web.search", output: { providerId: "fixture", results: [{ id: verification ? "v1" : "d1", title: "Documented object", url: verification ? "https://university.example/object" : "https://museum.example/object", snippet: "Documented object.", source: verification ? "university.example" : "museum.example" }] } };
  } } });
}

function agentWithDirection(directionPayload, calls = [], capabilityCalls = [], extraDeps = {}) {
  return createResearchAgent({ config: {}, execute: async (_ctx, request) => {
    const text = request.messages.map((m) => m.content).join("\n"); calls.push(text);
    return { output: text.includes("Research Direction") ? directionPayload : report({ factual: "STRONG" }), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "fixture", provider: "fixture", latencyMs: 1 };
  }, ...extraDeps, capabilityExecution: { executeCapability: async (request) => {
    capabilityCalls.push(request);
    return { status: "success", resultId: `result-${request.requestId}`, capabilityId: request.capabilityId, output: { providerId: "fixture", results: [] } };
  } } });
}

describe("Research Intelligence Direction Cycle V2", () => {
  const planScope = { workflowId: "wf-v2", correlationId: "corr-v2", taskId: task.id, recoverySuffix: ":recovery:test" };

  it("planning A/G materializes supported WEB_SEARCH and binds the compiled query", () => {
    const payload = mission();
    payload.discoveryLanes[0] = { ...payload.discoveryLanes[0], queryGuidance: "historic egypt", actualCapability: "WEB_SEARCH (SUPPORTED)" };
    const plan = materializeDiscoveryRetrievalPlan(payload, planScope, 4);
    strictEqual(plan.length, 1);
    strictEqual(plan[0].capabilityId, "web.search");
    strictEqual(plan[0].rawQuery, "historic egypt");
    ok(plan[0].compiledQuery !== plan[0].rawQuery);
    strictEqual(plan[0].request.input.query, plan[0].finalizedQuery);
    strictEqual(evaluateDiscoveryQueryQuality(plan[0].compiledQuery, payload, payload.discoveryLanes[0]).passes, true);
  });

  it("planning B/C/D materializes multiple supported lanes, skips unsupported lanes, and respects the envelope", () => {
    const payload = mission();
    payload.discoveryLanes = [
      { ...payload.discoveryLanes[0], laneId: "historical-evidence", actualCapability: "WEB_SEARCH (SUPPORTED)", maxCalls: 3 },
      { ...payload.discoveryLanes[0], laneId: "current-interest-signals", purpose: "Find current historical signals", queryGuidance: "Egypt heritage current coverage", actualCapability: "descriptive", maxCalls: 3 },
      payload.discoveryLanes[1],
      { ...payload.discoveryLanes[1], laneId: "youtube-discovery", desiredCapability: "YOUTUBE_DISCOVERY" },
    ];
    const plan = materializeDiscoveryRetrievalPlan(payload, planScope, 4);
    deepStrictEqual(plan.map((entry) => entry.laneId), ["historical-evidence", "current-interest-signals"]);
    ok(plan.length <= 4);
    ok(plan.every((entry) => entry.capabilityId === "web.search"));
  });

  it("planning E permits zero calls when no capability is supported", () => {
    const payload = mission();
    payload.availableCapabilities = payload.availableCapabilities.map((entry) => ({ ...entry, status: "UNSUPPORTED", via: [] }));
    deepStrictEqual(materializeDiscoveryRetrievalPlan(payload, planScope, 4), []);
  });

  it("planning F fails when a supported lane cannot materialize required runtime fields", () => {
    const payload = mission();
    payload.discoveryLanes[0] = { ...payload.discoveryLanes[0], queryGuidance: "" };
    throws(() => materializeDiscoveryRetrievalPlan(payload, planScope, 4), /RETRIEVAL_PLAN_MATERIALIZATION_FAILED/);
  });

  it("contract A: canonicalizes an omitted runtime-owned stage before validation and discovery", async () => {
    const payload = mission(); delete payload.stage;
    const capabilityCalls = [];
    const result = await agentWithDirection(payload, [], capabilityCalls).execute({ context, input: input() }, signal);
    strictEqual(result.output.researchPlan.stage, "research");
    ok(capabilityCalls.length > 0);
  });

  it("identity A: canonicalizes an omitted runtime-owned taskId before retrieval", async () => {
    const payload = mission(); delete payload.taskId;
    const capabilityCalls = [];
    const result = await agentWithDirection(payload, [], capabilityCalls).execute({ context, input: input() }, signal);
    strictEqual(result.output.researchPlan.taskId, task.id);
    ok(capabilityCalls.length > 0);
  });

  it("identity B/J: preserves exact taskId and stage without changing semantic fields", async () => {
    const payload = mission();
    const result = await agentWithDirection(payload).execute({ context, input: input() }, signal);
    strictEqual(result.output.researchPlan.taskId, payload.taskId);
    strictEqual(result.output.researchPlan.stage, payload.stage);
    strictEqual(result.output.researchPlan.missionId, payload.missionId);
    strictEqual(result.output.researchPlan.objective, payload.objective);
  });

  it("identity C: rejects a conflicting taskId before retrieval", async () => {
    const payload = { ...mission(), taskId: "wrong-task" };
    const capabilityCalls = [];
    await rejects(agentWithDirection(payload, [], capabilityCalls).execute({ context, input: input() }, signal), /invalid report structure/);
    strictEqual(capabilityCalls.length, 0);
  });

  it("identity D provider-free E2E: restores stage and taskId then reaches compiled retrieval", async () => {
    const payload = mission(); delete payload.stage; delete payload.taskId;
    payload.discoveryLanes[0] = { ...payload.discoveryLanes[0], queryGuidance: "historic egypt", actualCapability: "WEB_SEARCH" };
    const capabilityCalls = [];
    const result = await agentWithDirection(payload, [], capabilityCalls).execute({ context, input: input() }, signal);
    strictEqual(result.output.researchPlan.taskId, task.id);
    strictEqual(result.output.researchPlan.stage, "research");
    ok(capabilityCalls.length > 0);
    ok(String(capabilityCalls[0].input.query).length > "historic egypt".length);
    strictEqual(evaluateDiscoveryQueryQuality(capabilityCalls[0].input.query, result.output.researchPlan, result.output.researchPlan.discoveryLanes[0]).passes, true);
  });

  it("identity G: reusable normalizer never edits model-authored semantic fields", () => {
    const payload = { taskId: task.id, stage: "research", objective: "semantic owner", missionId: "mission-semantic" };
    const normalized = normalizeRuntimeIdentityEchoes(payload, [
      { field: "taskId", canonicalValue: task.id, expected: "exact task identity echo" },
      { field: "stage", canonicalValue: "research", expected: "exact stage identity echo" },
    ]);
    strictEqual(normalized.objective, payload.objective);
    strictEqual(normalized.missionId, payload.missionId);
  });

  it("identity H: fails closed when a declared runtime identity has no canonical source", () => {
    throws(() => normalizeRuntimeIdentityEchoes({}, [{ field: "workflowId", canonicalValue: undefined, expected: "exact workflow identity echo" }]), /invalid report structure/);
  });

  it("contract B: rejects an explicit conflicting stage before discovery", async () => {
    const payload = { ...mission(), stage: "writer" };
    const capabilityCalls = [];
    await rejects(agentWithDirection(payload, [], capabilityCalls).execute({ context, input: input() }, signal), /invalid report structure/);
    strictEqual(capabilityCalls.length, 0);
  });

  it("contract C: missing substantive mission fields still fail closed", async () => {
    const payload = mission(); delete payload.objective;
    await rejects(agentWithDirection(payload).execute({ context, input: input() }, signal), /invalid report structure/);
  });

  it("contract D: malformed discovery lanes still fail closed", async () => {
    const payload = { ...mission(), discoveryLanes: [{ laneId: "broken" }] };
    await rejects(agentWithDirection(payload).execute({ context, input: input() }, signal), /invalid report structure/);
  });

  it("contract E: V1 compatibility remains on the legacy single-call path", async () => {
    const legacyInput = { ...input(), synthesisContract: "amf-research-synthesis-v1" };
    let calls = 0;
    const agent = createResearchAgent({ config: {}, execute: async () => { calls += 1; return { output: report(), raw: "{}", usage: {}, model: "fixture", provider: "fixture", latencyMs: 1 }; } });
    await agent.execute({ context, input: legacyInput }, signal);
    strictEqual(calls, 1);
  });

  it("contract F: an exact-stage V2 mission remains valid", async () => {
    const result = await agentWithDirection(mission()).execute({ context, input: input() }, signal);
    strictEqual(result.output.researchPlan.stage, "research");
  });

  it("repairs both generic historical queries against all mission dimensions", () => {
    const historical = mission();
    const lane = historical.discoveryLanes[0];
    for (const generic of ["historic egypt", "historic egypt Global Educational Shorts"]) {
      strictEqual(evaluateDiscoveryQueryQuality(generic, historical, lane).passes, false);
      const compiled = compileDiscoveryQuery(generic, historical, lane);
      const quality = evaluateDiscoveryQueryQuality(compiled, historical, lane);
      strictEqual(quality.hasGeographyContext, true);
      strictEqual(quality.hasHistoricalIntent, true);
      strictEqual(quality.hasConcreteCandidateIntent, true);
      strictEqual(quality.hasEvidenceIntent, true);
      strictEqual(quality.hasLaneIntent, true);
      strictEqual(quality.hasMarketLanguageContext, true);
      strictEqual(quality.passes, true);
    }
  });

  it("compiles fantasy without historical-truth verification language", () => {
    const fantasy = mission("ORIGINAL_FANTASY");
    fantasy.discoveryLanes[0] = { ...fantasy.discoveryLanes[0], laneId: "EVERGREEN_CURIOSITY", purpose: "Find original fantasy concepts", queryGuidance: "egypt fantasy" };
    const compiled = compileDiscoveryQuery("egypt fantasy", fantasy, fantasy.discoveryLanes[0]);
    ok(!/museum|archive|university|historical verification|reputable sources/i.test(compiled));
    ok(/concepts characters settings/i.test(compiled));
  });

  it("query A-G: capability finalizer compresses long prose without losing required dimensions or slicing words", () => {
    const payload = mission();
    const lane = { ...payload.discoveryLanes[0], laneId: "current-interest-signals", purpose: "Find current historical relevance signals" };
    const long = `${"Egypt historical museum archive named events people objects evidence Arabic current relevance signals ".repeat(5)}secondary descriptive wording`;
    const finalized = finalizeWebSearchQuery(long, payload, lane);
    ok(finalized.length <= WEB_SEARCH_MAX_QUERY_LENGTH);
    strictEqual(evaluateDiscoveryQueryQuality(finalized, payload, lane).passes, true);
    strictEqual((finalized.match(/\bEgypt\b/giu) ?? []).length, 1);
    ok(/events|people|artifacts|places/iu.test(finalized));
    ok(/museum/iu.test(finalized) && /archive/iu.test(finalized) && /university/iu.test(finalized));
    ok(/current relevance signals/iu.test(finalized));
    ok(!/[\p{L}\p{N}]$/u.test(finalized) || finalized.split(/\s+/u).at(-1).length > 1);
  });

  it("query D/E: an already valid short provider query remains unchanged", () => {
    const payload = mission();
    const lane = payload.discoveryLanes[0];
    const valid = "Egypt historical named events people objects museum archive sources opportunities Arabic";
    strictEqual(evaluateDiscoveryQueryQuality(valid, payload, lane).passes, true);
    strictEqual(finalizeWebSearchQuery(valid, payload, lane), valid);
  });

  it("query H: impossible mandatory semantics fail locally instead of truncating", () => {
    const payload = mission();
    throws(() => finalizeWebSearchQuery("historic egypt", payload, payload.discoveryLanes[0], 20), /LOCAL_QUERY_COMPILATION_FAILED/);
  });

  it("semantic packing A-L: V8 verbose lane becomes a deterministic traceable provider query", () => {
    const payload = mission();
    payload.audience = "Arabic-speaking audience";
    payload.platforms = ["Instagram Reels", "YouTube Shorts"];
    payload.discoveryLanes = [{
      laneId: "historical-subjects",
      purpose: "Discover documented Egyptian historical subjects and source-supported POV angles for short vertical content",
      queryGuidance: "Search Arabic and English for documented Egyptian people, civilizations, events, places, objects, artifacts, incidents and everyday-life settings. Favor authoritative museum, archive, university and reputable historical reference sources; collect evidence and citations for every factual claim. Preserve the Morroway short-form visual storytelling opportunity framing for Instagram Reels and YouTube Shorts.",
      desiredCapability: "WEB_SEARCH", actualCapability: "SUPPORTED via web.search", maxCalls: 3,
      expectedOutput: "Candidate concepts with source-backed claims and citations",
    }];
    const lane = payload.discoveryLanes[0];
    const compiled = compileDiscoveryQuery(lane.queryGuidance, payload, lane);
    const first = packWebSearchQuery(compiled, payload, lane);
    const second = packWebSearchQuery(compiled, payload, lane);
    ok(first.providerQuery.length <= WEB_SEARCH_MAX_QUERY_LENGTH); // A/I
    const quality = evaluateDiscoveryQueryQuality(first.providerQuery, payload, lane);
    ok(quality.hasGeographyContext && quality.hasHistoricalIntent && quality.hasConcreteCandidateIntent && quality.hasEvidenceIntent); // B
    ok(first.retainedOutsideProviderQuery.some((entry) => entry.dimension === "audience"));
    ok(first.retainedOutsideProviderQuery.some((entry) => entry.dimension === "platforms")); // C
    ok(!/search arabic and english|collect evidence and citations|preserve the morroway/iu.test(first.providerQuery)); // D
    strictEqual((first.providerQuery.match(/\bEgypt\b/giu) ?? []).length, 1); // E
    ok(/history/iu.test(first.providerQuery) && /sources|evidence/iu.test(first.providerQuery)); // F
    ok(first.providerQuery.split(/\s+/u).every((word) => !word.endsWith("…"))); // H
    deepStrictEqual(first, second); // K
    strictEqual(first.trace.originalQuery, compiled);
    ok(first.trace.retainedDimensions.includes("concrete_discovery_class")); // L
    const plan = materializeDiscoveryRetrievalPlan(payload, planScope, 4);
    strictEqual(plan.length, 1);
    strictEqual(plan[0].request.input.query, first.providerQuery);
    deepStrictEqual(plan[0].retainedOutsideProviderQuery, first.retainedOutsideProviderQuery);
  });

  it("semantic packing G keeps an already-good compact query materially unchanged", () => {
    const payload = mission();
    const lane = payload.discoveryLanes[0];
    const good = "Egypt history events artifacts museum archive sources evidence opportunities";
    strictEqual(finalizeWebSearchQuery(good, payload, lane), good);
  });

  it("semantic packing J fails only when essential compact semantics genuinely cannot fit", () => {
    const payload = mission();
    throws(() => packWebSearchQuery("verbose instructions", payload, payload.discoveryLanes[0], 12), /LOCAL_QUERY_COMPILATION_FAILED/);
  });

  it("provider-free scenario 3 gives two supported lanes purpose-specific bounded queries", () => {
    const payload = mission();
    payload.discoveryLanes = [
      { ...payload.discoveryLanes[0], laneId: "historical-subjects", purpose: "Discover documented historical subjects" },
      { ...payload.discoveryLanes[0], laneId: "current-context", purpose: "Find current heritage relevance signals", queryGuidance: "Long prose about current Egyptian museum and heritage calendar context for Arabic short-form audiences" },
    ];
    const plan = materializeDiscoveryRetrievalPlan(payload, planScope, 4);
    strictEqual(plan.length, 2);
    ok(plan.every((entry) => entry.finalizedQuery.length <= WEB_SEARCH_MAX_QUERY_LENGTH));
    ok(!plan[0].finalizedQuery.includes(payload.currentDate));
    ok(/current|relevance|signals/iu.test(plan[1].finalizedQuery));
    ok(plan[1].semanticRequirements.some((entry) => entry.dimension === "runtime_date" && entry.compactTerms.includes(payload.currentDate)));
  });

  it("provider-free scenario 4 packs candidate-specific verification without slicing", () => {
    const topic = "The exceptionally well documented ancient Egyptian workers village at Deir el-Medina and its surviving daily-life records";
    const query = buildVerificationQueryFor(topic);
    ok(query.length <= WEB_SEARCH_MAX_QUERY_LENGTH);
    ok(query.includes("Deir") && query.includes("Medina"));
    ok(/museum|archive|university/iu.test(query));
    ok(!query.endsWith("exception"));
    strictEqual(buildVerificationQueryFor(topic), query);
  });

  it("provider-free scenarios 1/2: V8-like mission reaches mocked web boundary while social context stays lineage-only", async () => {
    const payload = mission();
    payload.audience = "Arabic-speaking audience";
    payload.platforms = ["Instagram Reels", "YouTube Shorts"];
    payload.discoveryLanes = [
      {
        laneId: "historical-subjects",
        purpose: "Discover documented Egyptian historical subjects and source-supported POV angles",
        queryGuidance: "Search Arabic and English for documented Egyptian people, civilizations, events, places, objects, artifacts and daily-life settings. Favor museum, archive, university and reputable historical reference sources; collect citations for every factual claim and preserve short-form visual storytelling context.",
        desiredCapability: "WEB_SEARCH", actualCapability: "SUPPORTED via web.search", maxCalls: 3, expectedOutput: "candidates",
      },
      { laneId: "instagram-validation", purpose: "Assess Instagram signals", queryGuidance: "Instagram Reels trends", desiredCapability: "INSTAGRAM_DISCOVERY", actualCapability: "UNSUPPORTED", maxCalls: 1, expectedOutput: "limitation" },
      { laneId: "youtube-validation", purpose: "Assess YouTube signals", queryGuidance: "YouTube Shorts trends", desiredCapability: "YOUTUBE_DISCOVERY", actualCapability: "UNSUPPORTED", maxCalls: 1, expectedOutput: "limitation" },
    ];
    const capabilityCalls = [];
    const result = await agentWithDirection(payload, [], capabilityCalls).execute({ context, input: input() }, signal);
    strictEqual(capabilityCalls.length, 1);
    const query = String(capabilityCalls[0].input.query);
    ok(query.length <= WEB_SEARCH_MAX_QUERY_LENGTH);
    strictEqual(evaluateDiscoveryQueryQuality(query, payload, payload.discoveryLanes[0]).passes, true);
    ok(!/instagram|youtube|reels|shorts/iu.test(query));
    deepStrictEqual(result.output.researchPlan.platforms, payload.platforms);
    ok(result.output.retrievalPlan[0].retainedOutsideProviderQuery.some((entry) => entry.dimension === "platforms"));
  });

  it("provider-free scenario 5: zero-result search reaches honest empty synthesis", async () => {
    const payload = mission();
    const empty = { ...report(), candidateStories: [], sources: [], citations: [], confidence: 0.05, status: "insufficient_evidence", evidenceRisks: ["No usable retrieval evidence"] };
    const capabilityCalls = [];
    const agent = createResearchAgent({ config: {}, execute: async (_ctx, request) => {
      const text = request.messages.map((m) => m.content).join("\n");
      return { output: text.includes("Research Direction") ? payload : empty, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "fixture", provider: "fixture", latencyMs: 1 };
    }, capabilityExecution: { executeCapability: async (request) => {
      capabilityCalls.push(request);
      return { status: "success", resultId: `result-${request.requestId}`, capabilityId: request.capabilityId, output: { providerId: "fixture", results: [] } };
    } } });
    const result = await agent.execute({ context, input: input() }, signal);
    ok(capabilityCalls.length > 0);
    strictEqual(result.output.candidateStories.length, 0);
    strictEqual(result.output.status, "insufficient_evidence");
  });

  it("current date A/B/C: omitted, exact, and stale values all resolve from the injected runtime clock", async () => {
    for (const supplied of [undefined, "2026-09-26", "2025-03-08"]) {
      const payload = mission();
      if (supplied === undefined) delete payload.currentDate;
      else payload.currentDate = supplied;
      const result = await agentWithDirection(payload, [], [], { now: () => new Date("2026-09-26T12:00:00.000Z") }).execute({ context, input: input() }, signal);
      strictEqual(result.output.researchPlan.currentDate, "2026-09-26");
    }
  });

  it("current date D: current-signal query planning receives the canonical runtime date", async () => {
    const payload = mission();
    payload.currentDate = "2025-03-08";
    payload.discoveryLanes[0] = { ...payload.discoveryLanes[0], laneId: "current-interest-signals", purpose: "Find current relevance signals", queryGuidance: "Use extensive prose to investigate current Egyptian heritage relevance signals with named historical events people objects and museum archive university reputable evidence sources for an Arabic audience in Egypt" };
    const capabilityCalls = [];
    await agentWithDirection(payload, [], capabilityCalls, { now: () => new Date("2026-09-26T12:00:00.000Z") }).execute({ context, input: input() }, signal);
    ok(String(capabilityCalls[0].input.query).includes("2026-09-26"));
    ok(!String(capabilityCalls[0].input.query).includes("2025-03-08"));
  });

  it("uses available web capability honestly when social discovery is unsupported", async () => {
    const calls = [], capabilityCalls = [];
    await agentFor(report({ factual: "STRONG" }), calls, capabilityCalls).execute({ context, input: input() }, signal);
    strictEqual(capabilityCalls.some((call) => call.capabilityId === "social.discovery"), false);
    strictEqual(capabilityCalls.every((call) => call.capabilityId === "web.search"), true);
  });

  it("A/B plans before retrieval and reports unsupported Instagram honestly", async () => {
    const calls = [], capabilityCalls = [];
    const result = await agentFor(report({ factual: "STRONG" }), calls, capabilityCalls).execute({ context, input: input() }, signal);
    strictEqual(calls.length, 2);
    ok(calls[0].includes("CAPABILITY INVENTORY"));
    strictEqual(result.output.researchPlan.unavailableDesiredCapabilities[0].sourceType, "INSTAGRAM_DISCOVERY");
    strictEqual(capabilityCalls.some((call) => call.capabilityId === "social.discovery"), false);
    strictEqual(capabilityCalls.every((call) => call.capabilityId === "web.search"), true);
  });

  it("C keeps opportunity high while factual eligibility fails closed", async () => {
    const calls = [], capabilityCalls = [];
    const result = await agentFor(report({ opportunity: "HIGH", factual: "INCOMPLETE", recommended: true }), calls, capabilityCalls).execute({ context, input: input() }, signal);
    strictEqual(result.output.candidateStories[0].contentOpportunityAssessment.level, "HIGH");
    strictEqual(result.output.candidateStories[0].factualVerification.status, "INCOMPLETE");
    strictEqual(result.output.candidateStories[0].recommendedForProduction, false);
  });

  it("D preserves factual eligibility independently from weak evergreen opportunity", async () => {
    const calls = [], capabilityCalls = [];
    const result = await agentFor(report({ opportunity: "LOW", factual: "STRONG", recommended: true }), calls, capabilityCalls).execute({ context, input: input() }, signal);
    strictEqual(result.output.candidateStories[0].factualVerification.status, "STRONG");
    strictEqual(result.output.candidateStories[0].contentOpportunityAssessment.level, "LOW");
    strictEqual(result.output.candidateStories[0].recommendedForProduction, true);
  });

  it("E applies different historical and fantasy verification semantics", async () => {
    const historical = await agentFor(report({ factualMode: "HISTORICAL_POV", factual: "INCOMPLETE" }), [], []).execute({ context, input: input("HISTORICAL_POV") }, signal);
    const fantasyReport = report({ factualMode: "ORIGINAL_FANTASY", factual: "INCOMPLETE" });
    const fantasy = await agentFor(fantasyReport, [], []).execute({ context, input: input("ORIGINAL_FANTASY") }, signal);
    strictEqual(historical.output.candidateStories[0].recommendedForProduction, false);
    strictEqual(fantasy.output.candidateStories[0].recommendedForProduction, true);
  });

  it("F preserves candidate → claim → evidence → source lineage", async () => {
    const result = await agentFor(report({ factual: "STRONG" }), [], []).execute({ context, input: input() }, signal);
    deepStrictEqual(result.output.candidateStories[0].keyClaims, ["Claim"]);
    deepStrictEqual(result.output.candidateStories[0].sourceIds, [1]);
    strictEqual(result.output.sources[0].url, "https://museum.example/object");
  });
});
