# Injection

> Contracts only — declarations, no logic. How each prompt section gets its content.

| File | Injector | Section | Source |
|---|---|---|---|
| `memory.ts` | `DynamicMemoryInjector` | Memory | `MemoryEngine.retrieve()` → `LoadedMemory` |
| `company.ts` | `CompanyBrainInjector` | Company Brain | `memory/company/` (README + key docs) |
| `agent.ts` | `AgentBrainInjector` | Agent Brain | `packages/agents/{agent}/brain.md` |
| `workflow.ts` | `WorkflowContextInjector` | Workflow Context | `WorkflowContext` from Workflow Engine |
| `schema.ts` | `OutputSchemaInjector` | Output Schema | `schemas/output.schema.json` |
| `examples.ts` | `ExamplesInjector` | Examples | `prompts/examples.md` |

Each injector is a pure function: `(source, options) → Promise<InjectionResult>`. The `PromptCompiler` calls them in order during assembly.