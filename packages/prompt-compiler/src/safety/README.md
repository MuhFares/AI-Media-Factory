# Safety

> Contracts only — declarations, no logic.

Enforces guardrails from agent config + Brand Guidelines.

| Component | Purpose |
|---|---|
| `SafetyLayer` | Main entry: `check(prompt)`, `injectSafetyPreamble()`, `rewrite()` |
| `Guardrail` | Single rule with check function + violation action |
| `GuardrailSet` | Hard + soft guardrails + brand rules |
| `SafetyLayer.check()` | Returns `SafetyResult` (passed, violations, rewrittenPrompt) |

## Guardrail Types

| Type | Action | Example |
|---|---|---|
| Hard | Block prompt | Fabricated claims, PII, safety violations |
| Soft | Warn / Rewrite | Hype words, empty intensifiers, voice drift |

## Guardrail Sources

1. **Agent config.yaml** → `guardrails` block
2. **Brand Guidelines** (`memory/company/brand-guidelines.md`) → voice, forbidden terms, citation rules
3. **Company Values** → Evidence over Opinion, Safety & Brand Integrity

The Safety Layer is the **last section** in the prompt (highest priority, never trimmed).