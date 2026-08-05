# Approval Gates

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `approval.ts` | `ApprovalGate`, `ApprovalRequest`, `ApprovalDecision`, `ApprovalRule`, `ApprovalContext` | #15 |

Rules define when approval is required based on tool, cost, risk level. Decisions are async (can wait for human). Decisions are audited.