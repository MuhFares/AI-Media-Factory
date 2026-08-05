# Context Selection

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `selector.ts` | `ContextSelector`, `RetrievalRules`, `ContextSelector` | #1, #9 |

The `ContextSelector` is the main entry point for context retrieval. It applies:
1. **Retrieval Rules** — max per type, min relevance/confidence, capabilities
2. **Freshness Rules** — age limits, decay functions, never-expire types
3. **Relevance Scoring** — semantic, graph, keyword, recency, performance, confidence
4. **Ranking** — composite score with configurable weights

Output: `SelectionResult` with memory, workflow context, session context, and ranking summary.