# Intelligence

> Contracts only — declarations, no logic. Turns stored memory into trustworthy, self-improving knowledge.

| File | Req | Defines |
|---|---|---|
| `confidence.ts` | #13 | `ConfidenceScorer` — 0..1 from evidence, corroboration, recency decay, outcome validation |
| `attribution.ts` | #14 | `AttributionTracker` — provenance required on every write; no anonymous memory |
| `conflict.ts` | #15 | `ConflictResolver` — scoped/newer/higher-confidence wins; ties escalate; never silent overwrite |
| `lessons.ts` | #16 | `LessonsEngine` — observe → extract → validate → link → score → promote → feed back |

These implement the [Memory Intelligence Layer](../../../memory/company/memory-intelligence.md). Confidence gates autonomous action; attribution makes memory auditable; conflict resolution keeps the corpus coherent; the lessons engine is the flywheel's *learn* step.
