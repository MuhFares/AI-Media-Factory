# Morroway Research Intelligence Direction Cycle V2

Status: PARTIAL on 2026-09-25: contracts and focused provider-free scenarios are implemented and verified; live readiness remains blocked by budget/deployment state and an unresolved dedicated bounded-engine E2E failure. Live execution is not authorized by this program.

## Recovered state

Two interrupted sessions had already added most V2 contracts inside the existing Research Agent: `ResearchObjective`, `ResearchMission`, discovery lanes, candidate opportunities, candidate verification plans, capability-aware social handling, and final synthesis fields. The partial state did not compile, replaced rather than preserved the V1 synthesis path, and had no V2 scenario coverage. Those defects were repaired without resetting or cleaning the dirty repository.

## Canonical lifecycle

Owner/content objective → Orchestrator → Research Agent in `RESEARCH_DIRECTOR` mode → governed bounded discovery → deterministic evidence-backed candidate formation → verification planning → governed verification → Research Agent in `FINAL_RESEARCH_SYNTHESIS` mode → `amf-evidence-sufficiency-v1` business/evidence gate → Owner review → CEO eligibility.

No new canonical agent was created. `RESEARCH_DIRECTOR`, `DISCOVERY_ANALYST`, `VERIFICATION_PLANNER`, and `FINAL_RESEARCH_SYNTHESIS` are explicit modes/stages of the existing Research Agent.

Research begins with contract `amf-research-mission-v1`, not with a preselected query. The mission selects market, geography, language, platform, content pillar, trend mode, time horizon, relevant discovery lanes, source types, priorities, verification requirements, stop conditions, and risk notes from the objective. Egypt, Instagram, and Historical POV are dimensions, not global defaults.

## Capability truth

The direction prompt receives a caller-supplied canonical capability inventory. The runtime, not the model, is authoritative for `SUPPORTED`, `PARTIALLY_SUPPORTED`, and `UNSUPPORTED`. Desired-but-unavailable capabilities are preserved explicitly. Unsupported social discovery creates a blocked lifecycle result and cannot become evidence. Social metrics are copied only when a governed provider returned them; no virality or trend metric is inferred.

The current production inventory exposes governed `web.search`. Instagram and YouTube discovery are marked unavailable in the production V2 input because no corresponding governed production capability is registered on that path. Existing separate social adapters remain available to explicitly configured research-source-router consumers; their existence is not falsely treated as execution evidence.

## Evidence semantics

Discovery produces evidence before candidates. Every candidate retains discovery evidence IDs, claims, risks, and verification questions. Historical candidates receive bounded, candidate-scoped verification queries targeting primary/institutional or reputable sources. Social/content signals may raise content opportunity but never factual confidence.

Final synthesis keeps `contentOpportunityAssessment` separate from `factualVerification`. Historical candidates with anything below `STRONG` factual verification are deterministically not recommended for production even if opportunity is high. Original AI Fantasy does not require historical verification of fictional world facts; it still requires honesty about inspiration, originality, audience signals, and brand fit. Candidate source IDs must resolve to returned sources.

## Bounded execution and budget readiness

- LLM calls: exactly 2 in V2 (direction and final synthesis).
- Web-search calls: minimum 2 (one discovery and one verification), normal 4, hard implementation maximum 6 (3 discovery + 3 verification).
- Social calls: 0 with the current production capability inventory; any future enabled social lane remains separately governed.
- Calculable live cost: UNKNOWN until an authorized run fixes actual token use and selected search-provider price evidence.

Current live Morroway `PRE_MEDIA_PHASE` budget evidence is `research: limit 6, consumed 6, remaining 0`; `text_agent: limit 14, consumed 12, remaining 2`. This program did not mutate it. Therefore the code is ready, but a live V2 cycle is blocked until Owner authorizes/reset-increases the research-call budget. Recommended authorization sizes for a fresh V2 cycle are: minimum 2 research + 2 text calls; normal 4 research + 2 text calls; maximum 6 research + 2 text calls. These are ceilings, not targets.

The focused source-authority, evidence-gate, routing-input, and Research Agent suites pass. The separate scratch-Postgres `bounded-research-engine-e2e.test.js` still terminates on its first historical V1 scenario without emitting diagnostic detail; it remains an open regression investigation rather than being hidden or reclassified.

## Compatibility and authority

V1 `amf-research-synthesis-v1` remains unchanged and tested. V2 activates only for `amf-research-intelligence-v2`. Existing canonical model routing, CEO routing, source-authority classification, evidence sufficiency, bounded stop, cost governance, and Owner authority remain in force. The current live pilot content/workflow was not read-modified or resumed.
