# Versioning

> Contracts only — declarations, no logic.

| Concept | Description |
|---|---|
| `PromptVersion` | Semantic version (major.minor.patch) + content hash |
| `PromptTemplate` | Template string + required sections + budgets + hash |
| `VersionRegistry` | Register/resolve/list templates per agent |

## Version Bumping

| Change | Bump |
|---|---|
| Section order change, required sections change, schema breaking | Major |
| New optional section, template improvement | Minor |
| Typo fix, token optimization, typo in prompt | Patch |

Hash is SHA-256 of template content for cache invalidation. `VersionRegistry` manages registration and resolution.