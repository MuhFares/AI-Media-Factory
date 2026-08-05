# Ranking

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `ranker.ts` | `ContextRanker`, `RelevanceScore`, `RankSignals`, `RankingStrategy` | #2, #11 |

## Composite Ranking Score

```
Rank = w1·Relevance + w2·Recency + w3·Performance + w4·Confidence − w5·Conflict
```

| Signal | Weight | Source |
|---|---|---|
| Relevance | w1 | Semantic + graph + keyword |
| Recency | w2 | Time decay |
| Performance | w3 | Historical outcome quality |
| Confidence | w4 | Source confidence |
| Conflict | w5 (penalty) | Contradiction with higher-ranked |

Weights are per-agent/configurable and recalibrated by the learning loop.