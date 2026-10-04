# AMF Model Benchmark Design Correction V1 — Proof

- Dataset: `AMF-MRB-V1.1.0` (previous `AMF-MRB-V1.0.0`).
- Catalog snapshot: 458 current OpenRouter records; immutable source pricing retained.
- Roster: 24 canonical agents unchanged; 15 model-backed agent roles, 9 deterministic/provider-specific roles, plus Orchestrator as an explicit benchmark/runtime role.
- Pools: Orchestrator 8 hard-compatible candidates; Visual QA 8 hard-compatible multimodal candidates.
- Identity: 15 unique normalized families, 16 exact selected execution routes; zero batch routes treated as separate quality candidates.
- Tiers: 5 unique baseline/free, 8 unique low-cost candidate, 3 unique reference families across role pools.
- Tasks: 17 including `visual-qa-01`, `ceo-02`, and `orchestrator-02`.
- Calls/cost: A 51/$0; B 51/$0.0164932; C 18/$0.0080156; D 34/$0.053746; total 154/$0.0782548 token maximum. Recommended cap $0.32; current authorization and spend $0.
- Routing: assignments remain `PENDING_BENCHMARK_EVIDENCE`; production routing unchanged.
- Provider calls: zero.

- Verification: API build passed; focused design/UI/auth/syntax tests 12/12;
  Python facade tests 23/23; full API regression 169/169. Corrected candidates,
  benchmark plan, routing, and cost endpoints returned HTTP 200. The actual
  Owner Benchmarks tab displayed AMF-MRB-V1.1.0, 51/51/18/34 stage calls,
  $0.0783 token maximum, $0.32 recommended cap, all 17 tasks, early-stop
  policy, and UNKNOWN cost components. Source and served `app.js` SHA-256 both
  equal `4C646FA0682F14E5973AF5085D90A1EBFA512D3CD79F8C5BA83F20A7708B2457`;
  JavaScript syntax check passed.
