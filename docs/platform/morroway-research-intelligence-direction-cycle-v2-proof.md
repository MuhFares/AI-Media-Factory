# Morroway Research Intelligence Direction Cycle V2 — Provider-Free Proof

Date: 2026-09-25

- Research Agent build: PASS.
- Research Agent tests: 51/51 PASS.
- Worker TypeScript build: PASS.
- Focused worker research/context/source-authority/evidence tests: 48/48 PASS.
- Scenario A: Egyptian/Arabic historical objective selects objective-specific dimensions and bounded web lanes — PASS.
- Scenario B: desired Instagram discovery with unsupported production capability is reported unavailable and performs no fake social execution — PASS.
- Scenario C: HIGH content opportunity plus INCOMPLETE factual verification produces `recommendedForProduction=false` — PASS.
- Scenario D: STRONG factual verification plus LOW opportunity remains factually eligible while opportunity stays independently weak — PASS.
- Scenario E: Historical POV fails closed on incomplete factual verification; Original AI Fantasy does not apply historical verification to fictional world facts — PASS.
- Scenario F: candidate → claim → evidence/source ID lineage is retained and invalid source IDs fail structurally — PASS.
- Legacy two-phase synthesis regression: PASS.
- Source-authority/evidence sufficiency regression: PASS.
- Real LLM calls: 0.
- Real research calls: 0.
- Real social calls: 0.
- Additional spend: USD 0.00.
- Existing pilot mutated: NO.

Follow-up recovery diagnosed the scratch failure as concurrent test-harness
mutation of `global.fetch` and the agent registry. The provider-free bounded
engine now passes 5/5 across V1 and V2, including durable stop/reload and honest
insufficient evidence with zero CEO calls. See
`morroway-research-intelligence-v2-engine-readiness-recovery-v1.md`.

Runtime note: the validated build is not deployed because job 68 remains a
stale `running` job and ordinary worker startup would reclaim it. The Owner
explicitly prohibited mutating it. Live V2 still requires a separate bounded
research budget decision and a safe queue disposition before worker startup.
