# AMF Production Readiness

Status: **PARTIAL — source certification is substantially complete, but the final live/runtime and red-test gates below remain blocked.**

This is the authoritative readiness definition for AMF. Passing an isolated unit test, reaching a provider, or completing one stage does not make the platform ready. A production workflow may spend budget only after `AMF_PRODUCTION_PREFLIGHT` returns `READY` for its exact project, phase, call kind, and current stage.

## Exact READY criteria

`AMF_PLATFORM_READY = YES` requires all of the following at the same source/runtime build:

1. every production artifact contract has prompt, provider schema, parser, structural validator, semantic validator, and persisted representation parity;
2. every valid negative business outcome has a status-discriminated canonical shape;
3. every provider adapter preserves model, prompts, schema/format, sampling limits, tools, timeouts, request IDs, and safe metadata;
4. external results and raw responses are committed before downstream validation and survive later failure;
5. same logical replay is idempotent and distinct logical calls have distinct durable identities;
6. worker, Node API, and AMF Control are healthy, current, singleton-safe, and running in the supported Owner environment;
7. exact-worker egress is proven when the current stage requires an external provider;
8. stage-scoped credentials, bounded budgets, durable storage, and lineage are ready;
9. the provider-free Golden Workflow and fault matrix pass without orphan state, lost evidence, duplicate budgets, or duplicate external effects;
10. no production-blocking test failure remains;
11. an Owner can run `npm run platform:start`, inspect its truthful result, and run the exact preflight without engineering/PID archaeology.

The machine-readable certification state is `configs/platform/production-readiness-certification.json`. It fails closed while any category is uncertified.

## Production stage inventory

The executable inventory and its required-field validator live in `scripts/lib/platform-readiness-model.mjs`. Every row records entrypoint, contracts, provider role/adapter, schema generator, validators, persistence, recovery, identity, budget, terminal states, and next stage.

| Stage | Entrypoint | Input → output | Provider / budget | Persistence and recovery | Success / controlled stop |
|---|---|---|---|---|---|
| Idea | AMF Control governed task | owner objective → content identity | none | `content_items`, workflow submission; same-workflow recovery | content identity → Orchestrator |
| Orchestrator | `ProductionAgentExecutor` | content identity → `amf-pre-media-orchestrator-v1` | orchestrator / text | lifecycle + artifact; same-workflow recovery | completed → Direction |
| Research Direction | `ResearchAgent` | Orchestrator artifact → `amf-research-mission-v1` | research / text | lifecycle raw response; fresh recovery or exact audited reuse | validated mission → Retrieval |
| Retrieval | Research capability plan | mission → capability result/evidence | `web.search` / research | capability result and evidence committed immediately; reuse, never blind re-query | persisted result → Verification |
| Verification | candidate verifier | candidate + evidence → verification evidence | `web.search` / research | independent evidence rows; targeted recovery | verified/partial/unsupported → Synthesis |
| Research Synthesis | Research final synthesis | persisted evidence → discriminated `amf-research-synthesis-v1` | research / text | raw response + `research_report`; zero-call terminal reconciliation | candidate or no-candidate → CEO/stop |
| CEO / Strategy | CEO recommendation | Research artifact → `ceo_recommendation` | CEO / text | artifact + provenance; same-stage recovery | advance, return, or no candidate |
| Brief | planner synthesis | Research + CEO → evidence-backed brief | planner / text | artifact; planner recovery | brief → Writer |
| Writer | `WriterAgent` | evidence-backed brief → writer report | writer / text | artifact + provenance; revision recovery | script/content → Scenes |
| Scenes | Director | writer report → scene plan | director / text | artifact + `scene_specs` | scene plan → Visual Direction |
| Visual Direction | visual director | scene plan → visual contract | visual-director / text | artifact; same-stage recovery | approved contract → Image |
| Image | media chain | scene + visual contract → scene visual artifact | image capability / image budget | capability evidence + artifact + receipt; explicit regeneration | technical pass → Video |
| Video | supervised single-scene action | approved visual identity → Wan execution | RunPod Wan / video budget | supervised ledger + evidence; manual reconciliation/import | completed or reconciliation required |
| Composition | deterministic composer | video/audio/captions/timeline → final media | local / none | artifact + receipt; media technical resume | final media → Review |
| Owner Review | Decision Center | final media lineage → Owner decision | none | review/audit; review-only resume | approve, reject, defer, revision |
| Publishing | Publisher | approved media + fresh credential → published report | YouTube / publication | publication receipt + evidence; reconcile before resubmit | published or no-publication |
| Analytics | Analytics agent | published report → observation | YouTube analytics / analytics | observation + evidence; bounded recovery | observed or no-data |
| Learning | learning loop | observation → learning/recommendation | none | learning records; idempotent rebuild | recommendation → Next Cycle |
| Next Cycle | Owner proposal | learning → proposal | none | proposal + audit; Owner decision | proposed/deferred, then stop |

Special modes are part of these rows, not alternate undocumented pipelines: `STRUCTURED_JSON`, `json_schema`, web capabilities, image generation, supervised Wan, publication, analytics, Owner review, credential health, and worker diagnostics.

## Contract and negative-outcome policy

All positive model artifacts retain their complete required business fields. Negative outcomes use discriminated contracts and never inherit positive-only requirements.

| Outcome | Canonical behavior |
|---|---|
| `NO_PRODUCTION_CANDIDATE` | terminal, non-advancing Research artifact; empty candidates and explicit evidence risks |
| `INSUFFICIENT_EVIDENCE` | terminal, non-advancing; empty candidates; sources may be partial/empty; an empty visual placeholder is normalized to absence |
| `OWNER_DEFERRED` | terminal Owner decision with actor, reason, timestamp |
| `NO_PUBLICATION` | non-publication artifact tied to the source media |
| `NO_ANALYTICS_DATA` | observation-window result, not a provider/technical success claim |
| `CREDENTIAL_UNAVAILABLE` | stage-scoped block; unrelated pre-media stages remain eligible |
| `MANUAL_RECONCILIATION_REQUIRED` | non-advancing Wan state; no second POST |

Malformed JSON, truncation, reasoning-only output, missing fields, wrong enums, lineage mismatches, and unsupported positive claims remain technical failures. Negative contracts do not weaken positive contracts.

## Persistence boundaries

- External result receipt is a commit boundary.
- `capability_executions` and `execution_evidence` are saved immediately after each result, before another retrieval or synthesis.
- Raw LLM response evidence is independent of canonical artifact validation.
- Canonical artifacts are written only after structural, semantic, and lineage validation.
- A later failure cannot roll back prior evidence.
- Replay uses the same durable identity; a different workflow/execution/lane/query/attempt produces a different identity.
- Conflicting payload under an existing identity fails with `CAPABILITY_EVIDENCE_CONFLICT`; it never overwrites history.

## Provider adapter rules

Structured-output adapters must preserve `response_format.type=json_schema` and the exact schema. Downgrading `json_schema` to `json_object` is forbidden. Provider-safe evidence includes request ID, resolved model, finish reason, HTTP status, format, token/cost metadata when authoritative, and content/reasoning presence—not secret headers or hidden reasoning text.

The current closure adds provider-free regression coverage for OpenRouter schema forwarding and missing-schema fail-closed behavior. OpenRouter forwards strict `json_schema`; Alibaba explicitly rejects unsupported `json_schema` before transport rather than silently downgrading it. The structured provider suite passes 21/21 and the provider-adapters matrix passes 258/258. This is the certified production structured-adapter policy: preserve the exact schema or fail before transport.

## Runtime operations

- Check without mutation: `npm run platform:check`
- Start missing components only: `npm run platform:start`
- Stage-specific spend gate: `node scripts/amf-production-preflight.mjs --stage=<stage> --project=<project> --phase=<phase> --call-kind=<kind> --role=<routing-role> --workflow=<workflow-id>`
- Provider-free platform model: `npm run platform:certify`
- Canonical database test runner: `npm test --workspace @ai-media-factory/database` (loads the repository `.env`, derives/uses only an explicitly named test database, and fails closed before mutation if isolation cannot be proven)

`START PLATFORM` never kills an untracked process. It uses the canonical worker singleton launcher, refuses duplicate/ambiguous worker state, starts only missing API/UI components, and exposes health rather than hiding failures. Stale current processes requiring replacement remain an explicit controlled-handover operation.

`AMF_PRODUCTION_PREFLIGHT` checks database, source/dist build identity, Node API build, AMF Control source hash, exact worker singleton/build, queue, contract/adapter/persistence/recovery certification, stage-scoped credentials, bounded budget, storage, lineage, production routing, and recent exact-worker egress proof. Missing workflow, phase, call-kind, or role blocks spend authorization.

## Provider-free Golden Workflow and fault matrix

`scripts/platform-readiness-certify.mjs` exercises ten logical scenarios across all 19 stages:

1. full positive candidate → next-cycle proposal;
2. insufficient evidence → no production candidate;
3. Owner defer → Owner-deferred terminal state;
4. provider structural failure → deterministic technical failure;
5. downstream persistence failure → prior evidence retained;
6. controlled resume → paused Research boundary with zero duplicate calls;
7. credential unavailable;
8. publication skipped;
9. analytics empty response;
10. next-cycle proposal.

The 35-case matrix includes timeout, 4xx/5xx, malformed/truncated output, missing/invalid fields, empty optionals, valid negatives, duplicate dispatch/response, database failures on both sides of persistence, validation after retrieval, crash after external success, stale/duplicate runtimes, root/dist mismatch, Owner-start partial failure, restricted-launch egress, schema loss, exhaustion, stale credentials, evidence collision, lineage mismatch, cancellation, and manual reconciliation. Every case prohibits blind retry.

## Known defect disposition

1. OpenRouter schema loss: fixed on both production and shared OpenRouter paths; regression added.
2. Research generic-schema misuse: dedicated mission schema exists; regression retained.
3. stage/mission ambiguity: top-level `stage=research` contract remains enforced.
4. `visual={}` negative failure: fixed with status-aware normalization; positive malformed visual remains rejected.
5. retrieval rollback/loss: fixed for future calls by immediate durable persistence; historical Job 95 payload loss cannot be fabricated.
6. restricted-tree TCP `EACCES`: Owner launch plus exact-worker egress proof remains required; START PLATFORM does not claim egress without proof.
7. history-window `liveCount`: health now separates `liveCount` (OS-alive, fresh heartbeat, singleton/launcher-correlated) from `recentHeartbeatHistoryCount` and `recentBuildIds`.
8. stale launcher PID: canonical launcher verifies command/start/presence and cleans only proven stale state.
9. runtime/source drift: preflight compares exact build IDs and blocks.
10. historical evidence identity collision: scoped deterministic identities retained; collision fails closed.
11. Writer lineage fixture failures: fixed by supplying the canonical Research → Brief parent lineage and current semantic fields; Writer passes 15/15 and the combined worker lifecycle/durability suite passes 54/54.

## Certification evidence

- Research agent: 103/103 pass.
- Writer agent: 15/15 pass.
- Shared provider structured-output modes: 21/21 pass.
- Provider adapters: 258/258 pass.
- Worker lifecycle and Research durability: 54/54 pass.
- Bounded Research integration: 7/7 pass.
- Targeted database migration/reconciliation/Wan tests with the canonical `.env`: 9/9 pass.
- Platform inventory/contract/fault/Golden certification: 15/15 harness tests, 26/26 contract families (12 cases each), 96/96 recovery cases, 35/35 deterministic injected failures, and 10/10 workflow scenarios.
- Root workspace build: PASS, including repaired `context-engine`, `evaluation-framework`, and `prompt-compiler` NodeNext/type/package boundaries.
- Canonical database default runner: 322/322 PASS; it loads repository connection metadata, derives an explicitly named isolated test database, and refuses the application database.
- API integration runner: 224/224 PASS. Retired `ship`/`research` directive assumptions were replaced with canonical `produce-pre-media` behavior; the governed ASK/MULTI dispatch default now persists a current inert definition without restoring legacy directives.
- Bounded Research integration: 7/7 PASS, including positive, insufficient-evidence, unsupported-capability, zero-result, verification, same-workflow recovery, and fail-closed paths. The prior timeout was a test-environment defect: a provider-free transport fixture inherited the host's restricted-network marker and was rejected by canonical preflight before Direction. The suite now explicitly models a supported runtime while every external transport remains mocked or forbidden.
- Research durability/lineage regressions: 15/15 PASS; canonical `verification-{candidateId}` invocation identities are used by production dispatch, recovery loading, fixtures, and candidate evidence remains independently durable.
- Platform recovery/idempotency certification: PASS (96/96 modeled stage recovery cases plus the live database-backed bounded Research retry/durability coverage above).

## Topic-02 disposition

Job 95’s raw synthesis is durable and semantically says `insufficient_evidence`. Historical retrieval payloads absent from durable result/evidence storage cannot be reconstructed or fabricated. Classification: `HISTORICAL_NON_RECOVERABLE_DATA_LOSS`. The record remains auditable and non-advancing; the future durability class is regression-certified, so this historical loss is not itself a blocker for future workflows.

## Remaining blockers

- source/integration closure is complete at build `f974d4099029fb3de10e4a261d72d154403d559b6aa13811f8e972c8f4b32b41`; the deterministic platform build identity now includes Node API dist bytes so control-plane drift cannot masquerade as current;
- production runtime handover was intentionally outside the source-only closure task; the existing worker/API/Control processes were not touched;
- the canonical Owner must now perform the exact verified-PID handover and `npm run platform:start`, placing Worker, Node API, and AMF Control on build `f974d409…`;
- exact-worker egress for the final build was therefore not attempted; the latest HTTP 200 proof belongs to the old worker build and is not reusable;
- consequently the actual final-runtime `AMF_PRODUCTION_PREFLIGHT` has not returned `READY`;
- the live bounded Golden Canary remains intentionally unauthorized until all of the above close.

Therefore source is `READY_FOR_FINAL_RUNTIME_HANDOVER = YES`. Platform-wide `AMF_PLATFORM_READY` and Golden Canary readiness remain pending the separately authorized final runtime handover, exact-worker egress HTTP 200, and an actual `AMF_PRODUCTION_PREFLIGHT = READY` result.
