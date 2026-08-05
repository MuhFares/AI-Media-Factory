# Improvement

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `improvement.ts` | `ImprovementProposal`, `CurrentPerformance`, `ProposedChange`, `ExpectedImpact`, `ImprovementLoop`, `ImprovementCycle`, `CycleConfig`, `CycleSummary` | #9 |

Continuous improvement loop: `analyzeAndPropose` → `submitProposal` → `reviewProposal` → `executeProposal` → `monitorImpact` → `rollback`. Auto-approves low-risk, human review for high-risk. Tracks cycle metrics (proposals generated/approved/implemented/rolled-back, net impact, cost savings).