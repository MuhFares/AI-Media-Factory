# Morroway Phase-1 Runtime Remediation V1 — Proof

Date: 2026-09-25

## Acceptance matrix

| Requirement | Evidence | Result |
|---|---|---|
| Bounded Phase-1 runtime | `produce-pre-media`, 10 agent stages, final Owner gate | PASS |
| Phase-specific preflight | Canonical text/research only; `mediaReadinessRequired=false` | PASS |
| Durable project context | API submission stores explicit `projectId=morroway` through workflow context | PASS |
| Canonical routing | Real production executor resolves active project routes before transport | PASS |
| Legacy override blocked | Canonical routing override is injected after legacy config and is authoritative | PASS |
| Research separation | Capability retrieval followed by routed synthesis | PASS |
| Per-call budget | Atomic Postgres reservation before transport, reconciliation after | PASS |
| Idempotency/resume | Stable call keys plus engine checkpoints and zero retry policy | PASS |
| Artifact lineage | Existing collaboration artifacts preserve workflow, producer, parent, and correlation | PASS |
| Owner gate | Durable approval and successful `owner_pre_media_review_required` submission state | PASS |
| Phase-2 safety | No media/publication step exists; media authority remains NOT_GRANTED | PASS |
| Owner review package | Content UI exposes artifacts, QA, route/model lineage, reservations/cost, warnings | PASS |

## Tests executed

- Builds: `@ai-media-factory/shared`, `database`, `orchestrator`, `worker`, `api`.
- 24 orchestration/routing/Owner UI tests passed, including an in-memory
  durable-engine run through the real routing boundary to the Owner gate.
- Atomic database reservation test passed against isolated
  `ai_media_factory_test` loaded from `.env` credentials.
- Two isolated Postgres/API tests passed.
- Six Python auth/session and production-enablement facade tests passed.
- `node --check apps/api/src/ai_media_factory/static/app.js` passed.
- Node API was restarted without starting a worker. Live facade read at
  `127.0.0.1:8000` returned `PRE_MEDIA_PHASE`, ten canonical routes,
  `mediaReadinessRequired=false`, no blockers and `providerCallsMade=0` for the
  existing read-only walkthrough item. Served/source `app.js` SHA-256 matched.

The monorepo-wide workspace build was also attempted. It still reports unrelated
pre-existing compile debt in `context-engine`, `evaluation-framework`, and
`prompt-compiler`; the complete remediation dependency chain above builds cleanly.

## Side-effect proof

`REAL_LLM_CALLS=0`, `REAL_RESEARCH_CALLS=0`, `IMAGE_GENERATIONS=0`,
`VIDEO_GENERATIONS=0`, `VOICE_GENERATIONS=0`, `UPLOADS=0`,
`PUBLICATION_SIDE_EFFECTS=0`, `M4_CALLS_CONSUMED=0`.
