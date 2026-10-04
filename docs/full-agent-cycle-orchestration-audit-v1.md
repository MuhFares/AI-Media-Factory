# Full Agent Cycle & Orchestration Audit V1

Status: `PARTIAL`; `FULL_CONTENT_PIPELINE_V3 = BLOCKED`.

This audit is based on executable source, not the older aspirational event-bus documentation. The API entry point is `apps/api/src/handler.ts`; it validates and compiles directives. The production composition root is `apps/worker/src/cli.ts`, which constructs PostgreSQL persistence/queue, `WorkflowWorker`, `buildDefaultEngine`, and `createProductionAgentExecutor`. The worker constructs the provider boundary and the Research Source Router from environment configuration without exposing credentials.

## Actual execution

`produce` is compiled by `packages/orchestrator/src/templates.ts` as:

`research → writer → seo → brand → review → thumbnail → video → qa → publisher → analytics`

Artifacts are persisted and linked by workflow/correlation identity when the production CLI supplies `PostgresPersistence`. The worker’s production executor directly maps the ten production agents. Planner, Director, Media/Composer, Growth, Finance, and CEO packages exist, but are not part of this production `produce` graph. Legacy directives can use Planner and other steps, but non-production worker steps fall back to a deterministic placeholder.

The production research path is wired: Research receives an injected `ResearchSourceRouter`, which can route web/YouTube/social capabilities according to the accepted provider policy. Writer receives the persisted `research_report`. The worker does not currently route a `ResearchResult` back through Planner for post-research synthesis.

## Gates and safety

The Workflow Engine implements durable checkpoints, recovery, retries, branch/parallel primitives, and `GateStep`/approval signaling. `ReviewerFeedbackLoop` and `QualityWorkflow` implement bounded rework APIs. However, the `produce` definition is linear and contains no approval gate. Its Reviewer reviews the writer artifact structurally; there is no proven multimodal visual review, no explicit visual human gate before video/Wan, and no final content-review/human approval gate before Publisher. Publisher does enforce video, QA, brand, and runtime-evidence conditions, but that is not equivalent to human final authorization.

## Business loop

CEO, Growth, and Finance implementations exist with tests and decision contracts. They are not wired into the worker’s `produce` definition. Analytics is the terminal production step. Therefore the closed CEO → production → publishing → analytics → growth/finance → CEO loop is not executable as one production workflow.

## V3 blockers

P0 blockers are: missing post-research synthesis; missing visual review/QA/human gate before Wan; missing final product review/human publish gate; and missing TTS → measured timeline → Wan → composer integration in the production definition. P1 gaps include incomplete production agent registration, unconnected rework loop, optional persistence at the executor API boundary, and the current failing legacy orchestrator integration suite. Analytics/Growth/Finance/CEO feedback is recorded as P2 for a publish-ready-only first V3, but remains required for the complete business cycle.

Evidence JSON is in `output/architecture-audit/full-agent-cycle-v1/`. No external calls, media generation, publishing, commit, or push occurred during this audit.
