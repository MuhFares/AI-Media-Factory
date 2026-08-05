# Token Budgeting

> Contracts only — declarations, no logic.

Manages token budget allocation across the 9 sections.

## Allocation Strategy

| Section | Default % | Priority | Flexible |
|---|---|---|---|
| Safety | 5% | 100 (highest) | No |
| System | 5% | 90 | No |
| Output Schema | 5% | 80 | No |
| Company Brain | 15% | 80 | Yes |
| Agent Brain | 10% | 80 | Yes |
| Workflow Context | 15% | 70 | Yes |
| Memory | 25% | 60 | Yes |
| Examples | 15% | 30 | Yes |

**Total default: 100% of maxPromptTokens.**

## Allocation Algorithm

1. Assign each section its `maxTokens` ceiling from % allocation
2. If sum > `maxPromptTokens`, trim flexible sections by priority (lowest first)
3. Safety, System, Output Schema are **never trimmed**
4. If still over budget after trimming all flexible → error (prompt too large)

The `BudgetAllocator` interface handles allocation and trimming. See `budget.ts`.