# Validation

> Contracts only — declarations, no logic. Validates the final assembled prompt.

| Check | Error Code | Action |
|---|---|---|
| All required sections present | `MISSING_REQUIRED_SECTION` | Error |
| Total tokens ≤ budget | `OVER_BUDGET` | Error |
| Output schema valid JSON Schema | `SCHEMA_INVALID` | Error |
| Safety layer passes | `SAFETY_VIOLATION` | Error |
| No missing required sections | `SECTION_EMPTY` | Error |
| Template version valid | `INVALID_TEMPLATE_VERSION` | Error |

The `PromptValidator` runs these checks in `validate(prompt: FinalPrompt): ValidationResult`.