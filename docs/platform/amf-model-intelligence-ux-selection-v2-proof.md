# AMF Model Intelligence UX and Selection V2 Proof

Status: PASS — 2026-09-24.

- Actual served Owner URL verified: `http://127.0.0.1:8000/`.
- Overview rendered 458 total, 24 free, 353 paid, 81 unknown, 0 evaluated, 458 not evaluated, 4 configured routing entries, and the canonical refresh timestamp.
- Tabs verified in the served browser: Overview, Shortlist, All Models, Benchmarks, Routing, Price History.
- All Models loaded 25 rows on page 1 of 19; server-side search for `gemma` returned eight rows; detail opened for `google/gemma-4-26b-a4b-it:free`.
- Detail verified FREE pricing, context, capabilities, suggested roles, `NOT_EVALUATED`, shortlist membership, truthful `NO_HISTORY_AVAILABLE`, and collapsed raw evidence.
- Benchmarks displayed `NOT_EXECUTED`, 14 future main-group candidates, and the existing ten-task preparation matrix.
- Routing displayed read-only current configuration and `PRODUCTION ROUTING CHANGED: NO`.
- Price History displayed normalized USD/1M values, an exact-model filter, a 25-row cap, and truthful one-snapshot semantics.
- Main shortlist groups contained 14 unique model IDs; reference candidates represented four normalized provider families.
- JavaScript parse guard, TypeScript builds, Python compile, source/served bundle hash parity, isolated PostgreSQL tests, Owner UI tests, auth regression, and V1 snapshot immutability passed.
- No OpenRouter/AgentRouter inference, benchmark, media generation, publication, analytics, M4, or production-pilot action occurred.
