# Permissions

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `permissions.ts` | `Permission`, `PermissionPolicy`, `ConditionalPermission`, `PermissionEvaluator` | #4 |

12 base permissions + extensible string type. Supports conditional permissions based on context (time, workflow, brand, etc.).