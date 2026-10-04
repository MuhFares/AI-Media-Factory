# Post-Research Planner Synthesis V1

The production worker `produce` path now uses two typed stages of the existing Planner Agent:

`planner-initial (INITIAL_CONTENT_PLAN) → research → planner-synthesis (POST_RESEARCH_SYNTHESIS) → writer`

The initial stage contains intent and research questions, without factual claims. Research consumes that artifact and emits the existing `research_report`. The synthesis stage consumes both persisted artifacts and emits `evidence_backed_content_brief`, whose claims are explicitly `SUPPORTED`, `UNSUPPORTED`, or `UNCERTAIN` and retain evidence references. The Writer production handoff requires this brief and receives only normalized source evidence; a missing brief fails closed and cannot fall back to `research → writer`.

The existing Workflow Engine artifact persistence and lineage are reused. SEO, Reviewer ordering, visual gates, TTS/timeline/Wan/composer, and final human gates are intentionally unchanged and remain separate remediation work. No provider calls were made.
