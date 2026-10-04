# AMF Full Platform Product Architecture Audit V1

**Mode:** DEEP_READ_ONLY_AUDIT. No code, docs (other than this file), database,
workflows, providers, or authority were touched. All findings are repository
evidence as of 2026-09-23/24 (post-M4 private publication, pre-T+24h measurement).

**Baseline truth:** PRODUCTION_AUTHORITY = NOT_GRANTED,
GENERAL_PUBLICATION_AUTHORITY = NOT_GRANTED, PUBLIC_STATUS = NOT_PUBLISHED.
One private validation video exists (AfbPyQ-UFwM, Morroway channel).

---

## 1. Actual runtime architecture

**Services/processes (all localhost, manually supervised, no orchestrator):**
Node runtime API `:8080` (`apps/api/dist/server.js`: workflows + `/control/*`,
migrates on boot) · Python Owner facade/UI `:8000` (FastAPI + static app.js,
proxies to Node) · Persistent worker (`apps/worker/dist/cli.js`, queue polling,
sole provider executor) · PostgreSQL (single database; TEST DB derived by path).

**State:** PostgreSQL is the single system of record (~35 tables: workflow
submissions/jobs/instances/steps, artifacts, capability executions, provenance,
control_approvals/commands/projects/configuration, strategy x4 tables, human
gates, learning loop x4, provider_publications/sessions, media resumes,
visual iteration/director). No second store. No backup mechanism in repo.
Migrations are `IF NOT EXISTS` DDL executed on boot; no migration runner,
no rollback tooling beyond rebuilding.

**Execution model:** Postgres-backed durable queue → single persistent worker →
governed capability executors (`CapabilityExecutorPort` in tool-framework) →
provider adapters (provider-adapters) → artifacts + provenance rows. Command
Room has a second path (ASK/MULTI_AGENT_REVIEW via generalized agent runtime).
Idempotency keys, resumable sessions, provider budgets, and crash recovery
are real (media-resume, publish sessions).

**Frontend:** static app.js served by the Python facade with content-hashed
URLs. `apps/web` is a NON_CANONICAL_STUB. No auth on any route (declared:
"Local-only V1 ... Do not expose beyond localhost without auth (deferred P1)").

**Classification:** IMPLEMENTED — queue/worker/capabilities/adapters/provenance/
strategy/lifecycle/learning store/endpoints/UI. PARTIAL — analytics (ingest
proven, no product analytics), scheduling (trigger kinds exist in engine model,
no live scheduler), notifications (channel lists as config types only).
SCAFFOLD_ONLY — `apps/web`, `packages/mcp` (README only), second state store
references. DEAD/UNUSED — legacy thumbnail paths kept as fallbacks (marked
legacy in code). VALIDATION_ONLY — E2E loop execution paths proven with stubs
or single private validation artifacts.

## 2. Product capability map (43 domains)

| Domain | Status | Note |
|---|---|---|
| A. Project/Business Mgmt | PARTIAL | Registry exists (1 project); no Owner creation flow |
| B. Brand Mgmt | PARTIAL | Strategic BRAND entity real; no brand workspace UI beyond Strategy |
| C. Strategy | PROVEN_LIVE | 5 ACTIVE entities, review/activate journeys accepted |
| D. Research | IMPLEMENTED_NOT_LIVE_PROVEN | Adapters (Brave/Tavily/Serper/Exa/social) + routers exist; governed wiring partial |
| E. Competitor Intel | PARTIAL | Social/YouTube evidence adapters exist; no product surface |
| F. Ideation | SCAFFOLD_ONLY | No dedicated ideation flow; ideas enter via commands |
| G. Content Planning | IMPLEMENTED_NOT_LIVE_PROVEN | Planner agent + plan artifacts real |
| H. Brief Generation | IMPLEMENTED_NOT_LIVE_PROVEN | planner-synthesis artifacts real |
| I. Script Writing | IMPLEMENTED_NOT_LIVE_PROVEN | Writer agent + artifacts real |
| J. SEO/Metadata | IMPLEMENTED_NOT_LIVE_PROVEN | SEO agent + packages real |
| K. Visual Direction | IMPLEMENTED_NOT_LIVE_PROVEN | Visual-director contracts real, governed |
| L. Scene Planning | IMPLEMENTED_NOT_LIVE_PROVEN | Director + scene artifacts real |
| M. Image Generation | IMPLEMENTED_NOT_LIVE_PROVEN | RunPod/Zimage adapters + preflight real |
| N. Video Generation | VALIDATION_ONLY | Wan/RunPod chain executed for validation package only |
| O. Narration/Voice | IMPLEMENTED_NOT_LIVE_PROVEN | Voicetut TTS + chunk coordinator real |
| P. Music/Audio | MISSING | Referenced only as prohibited content |
| Q. Editing/Composition | IMPLEMENTED_NOT_LIVE_PROVEN | FFmpeg compose capability real |
| R. QA/Review | PROVEN_LIVE | QA agent, reviewer, technical QA, validation acceptance real |
| S. Human Approval | PROVEN_LIVE | Decision Center + gates + lifecycle attention accepted |
| T. Artifact Mgmt | PROVEN_LIVE | Workspace, viewer, preview accepted (Slice 7) |
| U. Lineage/Provenance | PROVEN_LIVE | Lineage endpoints, execution evidence accepted |
| V. Workflow Orchestration | IMPLEMENTED_NOT_LIVE_PROVEN | Rich engine (branches, parallel, compensation, retry, timeout, dead-letter); live use is the single produce chain |
| W. Agent Orchestration | PARTIAL | 24-member roster largely prompt/config scaffolding over ProductionAgentExecutor; real execution paths proven for research/planner/ceo/media |
| X. Provider/Model Mgmt | PARTIAL | Adapters + config events + allowlist mechanism real; deployment allowlist empty (UX-AGENT-004 blocked) |
| Y. Publishing | VALIDATION_ONLY | One private validation upload proven; no public path exercised; no publication management UI |
| Z. Channel/Account Mgmt | MISSING | No channel registry; OAuth bootstrap + guard are per-run file-based |
| AA. Analytics Ingestion | VALIDATION_ONLY | Transport proven HTTP 200; measurement pending |
| AB. Performance Analytics | MISSING | No comparison, dashboards, or time-series product |
| AC. Experimentation | PARTIAL | Strategic EXPERIMENT entities + M2 gate evaluation real; no product experiment UI |
| AD. Learning | PARTIAL | M2 loop store + proposal capability real; fed only by stubs so far |
| AE. Recommendation/Next Cycle | PARTIAL | Chain to Owner boundary proven; no live-data recommendation yet |
| AF. Cost Management | PARTIAL | UNKNOWN-preserving summaries accepted; no budgets, pricing, or chargeback |
| AG. Health/Observability | PARTIAL | Queue/worker/DB health accepted; no metrics/tracing/alerts |
| AH. Notifications | SCAFFOLD_ONLY | Channel lists as config types only |
| AI. Scheduling | SCAFFOLD_ONLY | Trigger kinds in engine model; no live scheduler |
| AJ. Automation/Autonomy | INTENTIONALLY_DEFERRED | Prohibited by program boundary; no scheduler, no auto-start |
| AK. User/Identity/RBAC | MISSING | Single implicit Owner; no auth, no users, no roles |
| AL. Audit/Compliance | PARTIAL | Gate/config/decision audit trails real; no compliance product |
| AM. Secrets/Credential Mgmt | PARTIAL | Env + 0600 files + gitignore defense real; no rotation, no vault, no OAuth refresh automation in runtime |
| AN. Deployment/Operations | PARTIAL | Proven manual restart pattern; no CI/CD deploy, no supervision, no health-gated rollout |
| AO. Backup/Recovery | MISSING | No backup mechanism; crash recovery exists only in-execution (sessions/idempotency) |
| AP. Multi-project isolation | PARTIAL | brand_id/project scoping throughout; single-project proven only |
| AQ. Multi-channel operation | MISSING | Single YouTube channel hardcoded per run; no registry |

Counts: PROVEN_LIVE 8, IMPLEMENTED_NOT_LIVE_PROVEN 12, PARTIAL 12,
VALIDATION_ONLY 4, SCAFFOLD_ONLY 4, MISSING 9, INTENTIONALLY_DEFERRED 1.

## 3. End-to-end Owner journey (30 steps)

OWNER_CAN_DO_NOW: 2 (define brand identity via Strategy), 19 (review content),
21 (approve content), 26–29 partially via accepted UI (read analytics surface
exists but no live data product; compare/evaluate/persist/recommend proven
only on stubs). BACKEND_ONLY: 9, 12–18, 22 (private publish path exists but
has no Owner initiation flow). VALIDATION_ONLY: 14–18 media stages, 22, 25.
PARTIAL: 2–5, 13, 20, 24. NOT_AVAILABLE: 1, 6–8, 10–11, 23 (public publish
never exercised), 30 (autonomous start prohibited by design).

Central finding: backend capability is NOT product capability. The platform
can technically produce content but the Owner cannot self-serve the journey:
no project creation, no provider/channel onboarding, no content initiation,
no publication management, no analytics product.

## 4. Agent system

Canonical roster is 24 entries in `agent-bootstrap.ts`, but ~2/3 are
"Plans X" delegating stubs over one shared ProductionAgentExecutor; real
differentiated implementations exist for research/planner/ceo/media/QA
families. Only ~10 have execution descriptors. Runtime components (2) are
correctly separated. No agent-to-agent messaging (orchestrated handoffs via
artifacts only), no per-agent memory (strategic snapshots + provenance serve
as memory), model resolution via PROJECT→AGENT config with empty deployment
allowlist (fail-closed, correct). Adding agents is safe (registry + catalog
+ config pattern) but most "new agents" would be prompt scaffolding until
given real executors. No duplication beyond the documented legacy thumbnail
fallback.

## 5. Workflow engine

A true reusable engine, not hardcoded chains: 6 directives
(plan/research/implement/verify/ship/produce), template system, state
machine (PENDING→RUNNING→RETRYING/COMPENSATING/PAUSED/AWAITING_APPROVAL…),
branches, parallel, compensation, retry/timeout policies, checkpoints,
dead-letter, audit log. Live usage is essentially the single `produce`
chain with governed gates. For multiple content types/projects/channels it
needs: parameterized templates per format (today: one produce template +
hardcoded gate insertions), project/channel context propagation, and a
live scheduler (trigger kinds exist, nothing fires them).

## 6. Media factory

Real provider integrations: RunPod images/Zimage, Wan video, Voicetut TTS,
FFmpeg composition, YouTube publish/analytics, web/social research.
Deterministic/local: TTS chunking, composition policy, QA validators,
thumbnail prompt derivation. Placeholder: music, captions as product
features, branding overlays, templates. Aspect ratios passed through to
capabilities; Shorts proven (31s private reel), long-form unproven.
Verdict: technically assembled and validated end-to-end once, NOT yet a
repeatable production-quality factory (single validation package, no
quality bars, no format matrix, no repeat runs).

## 7. Provider architecture

Adapters: OpenRouter + AgentRouter (LLM), RunPod (image/video/Zimage),
Voicetut (+groq/elevenlabs/azure voice options), YouTube publish +
analytics + research, Brave/Tavily/Serper/Exa + Apify/ BrightData social.
LIVE_PROVEN: YouTube publish (private) + analytics transport + research
reads (historical runs). Auth: env keys + Owner-local OAuth files; no
rotation, no per-project credential isolation. Retry: never auto-retried
for side-effecting calls (correct); analytics default maxRetries 2.
Failover: none (single provider per capability; ordered registries exist
for analytics only). Model selection: config events + allowlist (empty in
deployment). Swap-ability is real at the adapter boundary; lock-in is
operational (single wired provider each, credentials per deployment).

## 8. Data architecture

~35 tables, well-grouped (see §1). No duplicated truth found (single
registry, single actionability classifier, single lifecycle resolver).
Derived truth is explicit (lifecycle, actionability, projections).
Gaps: business-critical state in JSONB payloads (approval agent_
recommendation now also carries the validation bit — pragmatic, documented);
append-only discipline holds for audit/history/learning but artifacts and
submissions mutate status; no FKs observed (relationships by convention +
application checks); no retention policy; no backup. 100 projects: schema
scales (indexed project scoping) but single Postgres + repo-local files +
manual ops do not — needs object storage, background workers, and
connection discipline first.

## 9. Artifacts/storage

Identity via canonical IDs + sha256 recorded in payloads; lineage via
parent links + lineage endpoints; physical files under repo-local
output//artifacts/ served through a confined preview endpoint with digest
checks. No versioning (supersession by new rows), no dedup, no cleanup/
retention, no object-storage abstraction. Verdict: acceptable for
validation stage; object storage + lifecycle policy required before
multi-project operation.

## 10. Analytics + learning product

Proven: transport, shaping, empty-vs-zero semantics, M2 loop to Owner
boundary. Missing for a real product: historical time-series storage
(observations exist per-read, no rollups), cross-content and cross-channel
comparison, experiment dashboards, strategy feedback wiring (learning →
proposal exists; proposal → strategy activation is manual), Owner-visible
analytics/learning history surfaces. Path from "ingest metrics" to "knows
what works": scheduled reads → baselined comparisons → hypothesis
scorecards → recommendation queue — roughly half exists (reads, gates,
recommendations).

## 11. Owner experience gaps

Accepted V1.1 covers inspection/governance superbly. Missing product
journeys: project creation (backend missing), channel connection (backend
missing), provider configuration (backend exists, UI missing), content
calendar (missing entirely), content initiation (backend exists, UI
missing), publication management (backend partial, UI missing), analytics
dashboard (backend partial, UI missing), learning history (backend exists,
UI missing — Strategy collapsible only), budget management (missing),
notifications (missing).

## 12. Security / production readiness

Blockers for any exposure beyond trusted localhost: zero authentication
on all routes including mutating ones (declared, deferred P1); no RBAC/
users; no CSRF/CORS policy evidence; secrets in env + files (0600,
gitignored, no rotation/vault); OAuth refresh is manual CLI; DB has no
encryption-at-rest story in repo; inputs are validated per-endpoint
(allowlist-gated config, ID patterns, preview confinement — genuinely
good). Project isolation is by query scoping, untested adversarially.

## 13. DevOps/operations

Real: CI workflows (build/test per area), boot migrations, manual
controlled-restart pattern (proven 3x), health endpoints. Scaffold/READMEs
only: infra/docker (except voicetut-tts), monitoring, deployment, github
dirs. Missing: CD, supervision (processes die silently overnight —
observed twice), log aggregation, metrics/tracing/alerts, backups,
restore drills, versioned releases, rollback beyond rebuild+restart.

## 14. Scale

1 project / 1 workflow: proven. 10 projects: schema-ready, ops-fragile
(manual restarts, local files, single worker). 100 projects or 10+
concurrent workflows: single worker is the first bottleneck (one queue
consumer), then local disk, then connection churn (per-request pools are
fine, but no pooling policy documented). No numbers invented.

## 15. Debt / dead code

REMOVE: 20 root run-*.mjs one-off scripts (superseded by governed paths);
`work/` scratch duplication (verify before deleting). REFACTOR: lifecycle
publicStatus visibility-blindness (live mislabel since M4 upload);
boundary.test.ts unlisted-vs-authority drift. KEEP: legacy thumbnail
fallbacks (marked), media-resume V1 paths, research adapters. DEFER:
apps/web stub, mcp README-only package, context-engine duplicates
(thumbnail/video concepts overlap tool-framework — consolidate later).
Known flakes: lifecycle resolvedAt ms-boundary deep-equal (test-only).
Hardcoded Morroway assumptions: acceptable (reference project by design);
env-name mismatch AGENT_ROUTER vs AGENTROUTER still open (UX-AGENT-004).

## 16. Vision vs reality

Original vision (README + operating-system.md + architecture docs): an
AI-driven media generation platform operating real media businesses —
multi-brand SaaS ("AMF Studio"), marketplace, >90% autonomy.
Current reality: a superbly governed single-project validation rig that
proves each technical step once, wrapped in the best Owner-oversight UX
this auditor has seen at this stage — but with no self-serve product
loop, no second project, no public operation, and no autonomy (by design).
Governance focus was NOT misplaced: without Decision≠Authority,
idempotency, provenance, and validation-mode discipline, none of the live
proofs (private publish, analytics) could have been trusted. The imbalance
is now inverted: governance exceeds the factory it governs. Next
investment belongs in product capability, not more oversight.

## 17. Target platform (12 layers, monolith-first)

Owner Experience → Business/Project → Strategy Intelligence → Content
Factory → Agent Runtime → Workflow Runtime → Media Runtime → Artifact/Asset
→ Publishing → Analytics/Learning → Governance/Control Plane →
Provider Gateway → Data → Infra/Observability. Keep the deployable
monolith (api + worker + Python facade + Postgres); split only object
storage and background scheduling when scale demands. No microservices.

## 18. Gap-to-target per layer

Owner Experience: current inspection/governance excellent; gap = initiation
+ management journeys. Business/Project: registry only; gap = full CRUD +
onboarding. Strategy Intelligence: strong; gap = feedback wiring from
learning. Content Factory: single-chain proven; gap = format matrix +
quality bars. Agent Runtime: roster + executors; gap = memory/tools depth.
Workflow Runtime: engine genuinely reusable; gap = templates + live
scheduler. Media Runtime: integrated once; gap = repeatability + formats.
Artifact/Asset: lineage strong; gap = object storage + retention.
Publishing: one private upload; gap = management + multi-channel. Analytics/
Learning: ingest + loop proven; gap = product analytics + baselines.
Governance: best-in-class for stage; keep, don't expand. Provider Gateway:
boundary correct; gap = failover + rotation + per-project creds. Data:
sound + additive; gap = retention + backup + FK hardening. Infra: manual;
gap = everything in §13.

## 19. Reconstructed program roadmap

1. **Production Readiness Hardening** — visibility-aware publicStatus,
isolated TEST DB provisioning, deployment currency + supervision, boundary
test reconciliation. Objective: stop mislabeling reality; make verification
reproducible. Exit: Owner UI truthful under all visibility states; one-
command supervised stack.
2. **Core Productization (Morroway MVP)** — project/channel/provider
onboarding, content initiation, publication management, analytics + learning
history UI, budget visibility. Objective: Owner self-serve loop. Exit: 30-
step journey ≥ OWNER_CAN_DO_NOW for the happy path.
3. **Content Factory V2** — format matrix, quality bars, repeat runs,
music/captions/thumbnails-as-product, template library. Exit: 3 consecutive
governed packages meeting defined bars.
4. **Analytics Intelligence** — time-series, comparisons, hypothesis
scorecards, strategy feedback. Exit: "knows what works" demo on real data.
5. **Multi-Project / Multi-Channel** — object storage, per-project creds +
isolation proofs, second project + channel live. Exit: 2 projects operating.
6. **Automation (governed)** — scheduler, notifications, bounded auto-
advance between gates. Never L4 autonomy without explicit program.
7. **Scale** — worker pool, pooling policy, backups/restore drills, load
evidence. Exit: 10 concurrent workflows proven.

## 20. Prioritization

MUST_EXIST_BEFORE_REAL_OPERATION: authN/Z + localhost脱却, backups,
supervision, TEST DB provisioning, publicStatus fix. NEEDED_FOR_FIRST_REAL
CONTENT BUSINESS: program 2 + program 3. NEEDED_FOR_SCALE: programs 5 + 7.
LATER: marketplace/SaaS, L4 autonomy, apps/web rebuild, second state store.
Technical proof ≠ product MVP ≠ production-ready ≠ scaled — AMF today sits
between proof and MVP.

## 21. Real MVP definition

"AMF can operate the Morroway content business end-to-end" requires Owner
journeys: create project, connect channel + providers, set budgets, start
research, approve idea/brief/script/plan, generate + QA media, approve,
publish (private then explicitly public), read analytics, receive
learnings/recommendations, start next cycle — plus auth, reliability
(supervision + backup), and cost visibility. Missing today: onboarding
(project/channel/provider/budget), initiation + management UIs, analytics/
learning product surfaces, auth, backups, supervision, repeat-run quality
evidence.

## 22. Executive assessment

Built: a governed validation platform that truthfully proves each hard
technical step once, with exceptional Owner oversight. Today it is a
single-project validation rig with a real private YouTube publication and
a proven analytics transport — not yet a product. Distance to vision:
capability foundations ~60% present (mostly backend), productization
~20%, production operability ~25%, autonomy intentionally 0%. Biggest
structural gaps: no self-serve product loop, no auth/multi-tenancy,
local-disk + manual ops. Biggest product gaps: onboarding, initiation,
publication/analytics management. Biggest operational gaps: supervision,
backups, secrets rotation. Build next: Production Readiness Hardening,
then Morroway MVP productization. Do not build yet: autonomy/scheduler,
marketplace/SaaS, multi-channel scale, apps/web rebuild, second store.

---

## Appendix: audit method + provenance

Sources: README, docs/architecture.md (skimmed), docs/operating-system.md
(phases), docs/platform/ (all proof/boundary/tracker docs), package
manifests, agent-bootstrap.ts, orchestrator types/definition, workflow-
engine runtime model, tool-framework capability index, provider adapters
(YouTube/analytics/publish + mocks), database schema table list, handler
routes, static app.js (authority copy, no-auth notice), .github workflows,
docker/infra listings, scripts inventory. No providers called, no LLMs
called, no mutations, no tests executed (existing suite evidence reused).
Where docs and code disagree (e.g., stale README layout, tracker lines
predating closure), code and accepted proof evidence govern; disagreements
are noted inline rather than silently resolved.
