# AMF Agent Handoff Protocol (mandatory)

Every future remediation agent MUST follow this protocol. Scope violations and
fake completions are program failures.

## 1. Read first (in order)

1. `docs/remediation/AMF_REMEDIATION_STATUS.md`
2. `docs/remediation/AMF_PROGRAMS_01_TO_05_FINAL_HANDOFF.md`
3. `docs/remediation/AMF_KNOWN_RISKS.md`
4. `docs/remediation/AMF_HYGIENE_REGISTRY.md`
5. This file (`AMF_AGENT_HANDOFF_PROTOCOL.md`)
6. `docs/remediation/AMF_REMEDIATION_MASTER_PLAN.md`
7. The relevant `docs/remediation/programs/XX-*.md` file
8. `docs/remediation/AMF_E2E_CERTIFICATION_MATRIX.md`

Do NOT infer state from old chat transcripts or old milestone docs.

## 2. State before acting

Open the task by explicitly declaring:

- CURRENT_PROGRAM: (e.g. `PROGRAM_01_FOUNDATION_CONTRACTS` or `RESEARCH_PILOT_CLOSE`)
- CURRENT_TASK: (single task from the program file's `CURRENT_TASK` / `NEXT_TASK`)
- ALLOWED_SCOPE: (files/dirs from `SCOPE_IN` only)
- FORBIDDEN_SCOPE: (`SCOPE_OUT` + always-forbidden: runtime files outside scope,
  DB mutations unless declared, providers, workers, budgets, publication, media
  generation, audit/proof rewrites)
- EXPECTED_EXIT_CRITERIA: (provider-free scenarios + evidence required)

If the task is unclear, stop and ask rather than expanding scope.

## 3. Before implementation: inspect current source

Prior audit findings may already be fixed. Before treating any risk as an
active blocker:

- Read the actual current source (not the audit's quotation of it).
- If fixed, record `RESOLVED_AFTER_AUDIT` with file/line evidence in the
  program file changelog + risk entry — do not keep stale blockers alive.
- If unsure, record `UNKNOWN` and ask. Never invent timestamps, run IDs, or PASSes.

## 4. During the task

- Do not expand scope silently. One task, one program, one exit criterion.
- Documentation changes ONLY under `docs/remediation/` unless the program file
  explicitly authorizes runtime work (programs authorize their own
  `ENGINEERING_WORKSTREAMS`; this protocol never grants blanket runtime authority).
- Never: delete/move/rename runtime files; run providers; execute workflows;
  start/stop workers; mutate DB; publish; generate media — unless the program
  file's current task explicitly requires it AND Owner authority is recorded.
- Never rewrite historical audits/proofs. Append-only.

## 5. After the task: update remediation docs

Update, at minimum:

- The active `programs/XX-*.md`: `COMPLETED_TASKS`, `CURRENT_TASK`, `NEXT_TASK`,
  `BLOCKERS`, `CHANGELOG`.
- `AMF_REMEDIATION_STATUS.md` if program/task/blocker state changed.
- `AMF_KNOWN_RISKS.md` for any resolved or newly discovered risk.
- `AMF_HYGIENE_REGISTRY.md` for any hygiene state change.
- `AMF_E2E_CERTIFICATION_MATRIX.md` for any scenario run (with real run IDs/dates).

## 6. Record in the handoff report

- Files changed (must be docs-only unless program-authorized otherwise)
- Tests executed (command + result; `TEST_DATABASE_URL != DATABASE_URL` always)
- Provider calls (must be zero for provider-free tasks; list otherwise)
- DB mutations (must be none unless explicitly authorized; list otherwise)
- Budgets changed (must be none unless Owner-authorized)
- Worker refresh required? (build ID + deployment blocker if any)
- New blockers discovered
- Resolved risks (with evidence)
- Regression risks

## 7. Completion rules

- Never mark a Program completed based only on source implementation.
  Completion requires its defined exit criteria:
  - P1: E2E-01 + E2E-04 provider-free.
  - P2: E2E-11 + E2E-16 + reevaluation routing regressions, provider-free.
  - P3: E2E-03, E2E-06, E2E-07, E2E-12, E2E-18, provider-free.
  - P4: E2E-05, E2E-06, E2E-08, E2E-09, E2E-10 provider-free + bounded live item.
  - P5: multi-project + owner-operation scenarios provider-free + live Owner lifecycle.
- Never convert a historical `PASS` into current certification.
- Never mark `RESEARCH_PILOT CLOSED` until worker refresh + one text-capacity
  authorization + reevaluation-only recovery + artifact revision + Owner final
  decision are all evidenced.

## 8. Immutability

Historical audits/proofs remain immutable. This registry is the only mutable
remediation state. When in doubt: `UNKNOWN`, ask, and keep the diff
documentation-only.
