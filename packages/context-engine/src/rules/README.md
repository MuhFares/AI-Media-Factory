# Rules

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `retrieval.ts` | `RetrievalRules`, `RetrievalQuery` | #9 |
| `freshness.ts` | `FreshnessRules`, `FreshnessEvaluator` | #10 |
| `relevance.ts` | `RelevanceScorer`, `RelevanceScore` | #11 |

## Retrieval Rules
Controls what memory is eligible for retrieval:
- Max records per memory type
- Minimum relevance/confidence thresholds
- Required capabilities
- Recency boost and diversity factor

## Freshness Rules
Controls memory aging:
- Max age per memory type (ephemeral: 30d, rolling: 90d, permanent: never)
- Decay function (linear/exponential/step)
- Half-life for exponential decay
- Never-expire types (Company, Decision, Lessons)

## Relevance Scoring
Composite score from:
- Semantic similarity (vector)
- Graph proximity
- Keyword overlap
- Recency
- Past performance
- Source confidence