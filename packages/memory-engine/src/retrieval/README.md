# Retrieval

> Contracts only — declarations, no logic. The funnel behind `retrieve()`/`search()`.

| File | Req | Defines |
|---|---|---|
| `pipeline.ts` | #2 | `RetrievalPipeline` — scope → fetch → merge → conflict → rank → gate → cap |
| `search.ts` | #3, #10 | `SemanticSearch`, `KeywordSearch`, `HybridSearch` |
| `vector.ts` | #11 | `VectorIndex`, `Embedding`, `VectorHit` |
| `graph.ts` | #12 | `KnowledgeGraph`, `GraphNode`, `GraphEdge` |
| `ranking.ts` | — | `RankingStrategy`, `RankSignal`, `RankWeights` |

## Ranking

```
Rank = w1·Relevance + w2·Recency + w3·Performance + w4·Confidence − w5·Conflict
```

Relevance blends vector similarity and graph proximity. Weights are per-type/per-agent and recalibrated by the learning loop. See parent [README](../../README.md) §6.
