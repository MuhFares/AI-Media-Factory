# Prompt Compiler (`@ai-media-factory/prompt-compiler`)

> Architecture specification for the unified Prompt Compiler of AI Media Factory (AMF). **Contracts and architecture only** — the `src/**/*.ts` files are type/interface declarations with no implementation bodies. This package is the single authority for assembling the final prompt sent to any LLM provider.

## 0. Core Principle

**One compiler, one canonical prompt structure, zero agent-specific logic.** Every agent — CEO, Research, Writer, SEO, Thumbnail, Video, Publisher, Analytics, Finance, Growth, QA, Brand, Orchestrator — sends its data to the **PromptCompiler** which assembles the final prompt in a **strict, universal order**. The compiler knows nothing about agent logic; it only knows how to compose sections.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        PROMPT COMPILER                                       │
├────────────────────────────────────────────────────────────────────────────┤
│  Inputs (from Runtime)                                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │ Agent Config│ │ Agent Prompts│ │ Memory     │ │ Workflow Context    │  │
│  │ (config.yaml)│ │ (system,     │ │ (relevant) │ │ (workflow + step)   │  │
│  └─────────────┘ │  instruct,   │ └────────────┘ └─────────────────────┘  │
│                  │  examples)   │                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────────────────┐  │
│  │ Company Brain│ │ Agent Brain │ │ Output Schema (JSON Schema)         │  │
│  │ (memory/     │ │ (agent's    │ └─────────────────────────────────────┘  │
│  │  company/)   │  brain.md)  │                                           │
│  └─────────────┘ └─────────────┘                                           │
└────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   PromptCompiler    │  ← Single entry point
                    │  assemble(context)  │     returns FinalPrompt
                    └──────────┬──────────┘
                               ▼
                    ┌────────────────────────────────────────────────────┐
                    │           FINAL PROMPT (exact order)               │
                    ├────────────────────────────────────────────────────┤
                    │ 1. System Prompt                                   │
                    │ 2. Company Brain                                   │
                    │ 3. Agent Brain                                     │
                    │ 4. Workflow Context                                │
                    │ 5. Relevant Memory (RAG)                           │
                    │ 6. Examples (few-shot)                             │
                    │ 7. Current Task (input event)                      │
                    │ 8. Output Schema (JSON Schema)                     │
                    │ 9. Safety / Guardrails                             │
                    └────────────────────────────────────────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │ LLM Provider │  (via Provider Layer)
                        └──────────────┘
```

**Dependency direction:** `runtime → prompt-compiler`. The compiler has **no dependencies on runtime, providers, or workflow-engine**. It is a pure function: `PromptContext → FinalPrompt`.

---

## 1. The 17 Requirements → Where Each Lives

| # | Requirement | Home |
|---|---|---|
| 1 | `PromptBuilder` | `core/builder.ts` |
| 2 | `PromptCompiler` | `core/compiler.ts` |
| 3 | `PromptContext` | `core/context.ts` |
| 4 | `PromptTemplate` | `template/template.ts` |
| 4 | `PromptSections` | `sections/sections.ts` |
| 5 | Token Budgeting | `budget/budget.ts` |
| 6 | Prompt Ordering | `sections/ordering.ts` |
| 7 | Dynamic Memory Injection | `injection/memory.ts` |
| 8 | Company Brain Injection | `injection/company.ts` |
| 9 | Agent Brain Injection | `injection/agent.ts` |
| 10 | Workflow Context Injection | `injection/workflow.ts` |
| 11 | Output Schema Injection | `injection/schema.ts` |
| 12 | Examples Injection | `injection/examples.ts` |
| 13 | Safety Layer | `safety/safety.ts` |
| 14 | Prompt Validation | `validation/validation.ts` |
| 15 | Prompt Versioning | `versioning/versioning.ts` |
| 16 | Prompt Caching | `caching/cache.ts` |
| 16 | Prompt Metrics | `observability/metrics.ts` |

---

## 2. Folder Structure

```
packages/prompt-compiler/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # barrel (types only)
    ├── core/
    │   ├── README.md
    │   ├── context.ts              # PromptContext, FinalPrompt
    │   ├── compiler.ts             # PromptCompiler interface
    │   ├── builder.ts              # PromptBuilder (fluent API)
    │   └── template.ts             # PromptTemplate, PromptVersion
    ├── sections/
    │   ├── README.md
    │   ├── sections.ts             # PromptSections enum + ordering
    │   └── ordering.ts             # compile-time ordering enforcement
    ├── budget/
    │   ├── README.md
    │   └── budget.ts               # TokenBudget, BudgetAllocator
    ├── injection/
    │   ├── README.md
    │   ├── memory.ts               # DynamicMemoryInjector
    │   ├── company.ts              # CompanyBrainInjector
    │   ├── agent.ts                # AgentBrainInjector
    │   ├── workflow.ts             # WorkflowContextInjector
    │   ├── schema.ts               # OutputSchemaInjector
    │   └── examples.ts             # ExamplesInjector
    ├── safety/
    │   ├── README.md
    │   └── safety.ts               # SafetyLayer, Guardrail
    ├── validation/
    │   ├── README.md
    │   └── validation.ts           # PromptValidator, ValidationResult
    ├── versioning/
    │   ├── README.md
    │   └── versioning.ts           # PromptVersion, VersionRegistry
    ├── caching/
    │   ├── README.md
    │   └── cache.ts                # PromptCache, CacheKey
    └── observability/
        ├── README.md
        └── metrics.ts              # CompilerMetrics
```

---

## 3. The 11-Section Assembly Order (Enforced)

The compiler **must** assemble sections in this exact order. Each section is optional (may be empty) but the order is immutable.

| Order | Section | Source | Required? | Token Budget |
|---|---|---|---|---|
| 1 | **System** | Agent's `prompts/system.md` | Yes | 5% |
| 2 | **Company Brain** | `memory/company/` (README + key docs) | Yes | 15% |
| 3 | **Agent Brain** | Agent's `prompts/brain.md` (or equivalent) | Yes | 10% |
| 4 | **Workflow Context** | `WorkflowContext` from Workflow Engine | Yes | 15% |
| 5 | **Relevant Memory** | Memory Engine `retrieve()` top-k | Yes | 25% |
| 5 | **Examples** | Agent's `prompts/examples.md` | No | 15% |
| 7 | **Current Task** | Input event (`RuntimeInput.event`) | Yes | 5% |
| 8 | **Output Schema** | Agent's `schemas/output.schema.json` | Yes | 5% |
| 9 | **Safety** | Agent's `config.yaml` guardrails + Brand Guidelines | Yes | 5% |

> **Total budget target:** ≤ 80% of model context window (leaves 20% for completion).

---

## 4. Core Types

### 4.1 PromptContext (The Input)

```typescript
interface PromptContext {
  // Static agent config
  agent: AgentConfig;
  // Agent's prompt files (system, instructions, examples)
  prompts: PromptSet;
  // Resolved from Memory Engine retrieve()
  memory: LoadedMemory;
  // From Workflow Engine
  workflow: WorkflowContext;
  // The input event that triggered this turn
  inputEvent: RuntimeEvent;
  // Agent's output schema (JSON Schema)
  outputSchema: JsonSchema;
  // Compiled safety rules from config + brand guidelines
  guardrails: GuardrailSet;
  // Budget constraints
  budget: TokenBudget;
}
```

### 4.2 FinalPrompt (The Output)

```typescript
interface FinalPrompt {
  sections: PromptSection[];
  totalTokens: number;
  budgetUsed: number;
  budgetRemaining: number;
  version: PromptVersion;
  cacheKey: CacheKey;
  metadata: CompileMetadata;
}

interface PromptSection {
  type: SectionType;          // enum: System, CompanyBrain, AgentBrain, WorkflowContext, Memory, Examples, Task, OutputSchema, Safety
  content: string;
  tokens: number;
  priority: number;           // for budget trimming (Safety = highest)
  required: boolean;
}
```

---

## 5. Injection Pipeline (How Each Section Is Built)

| Section | Injector | Logic |
|---|---|---|
| **System** | Direct | Read `prompts/system.md` → trim to budget |
| **Company Brain** | `CompanyBrainInjector` | Concatenate `memory/company/README.md` + key docs (vision, mission, values, north-star, decision-framework) → truncate to budget |
| **Agent Brain** | `AgentBrainInjector` | Read `packages/agents/{agent}/brain.md` (or synthesize from system + instructions) |
| **Workflow Context** | `WorkflowContextInjector` | Serialize `WorkflowContext` (brand_id, correlation_id, outputs, data) as structured text |
| **Relevant Memory** | `DynamicMemoryInjector` | Call `MemoryEngine.retrieve(query)` → format top-k as "Memory: {id} | {type} | {confidence} | {body}" |
| **Examples** | `ExamplesInjector` | Read `prompts/examples.md` → format as few-shot (Input → Output pairs) |
| **Current Task** | Direct | Serialize `RuntimeInput.event` as "Task: {type} | Payload: {json}" |
| **Output Schema** | `OutputSchemaInjector` | Convert `JsonSchema` → "Output must conform to this JSON Schema: {schema}" + example |
| **Safety** | `SafetyLayer` | Merge `config.guardrails` + `brand-guidelines.md` → "You MUST: ... You MUST NOT: ..." |

---

## 6. Token Budgeting (Req #5)

```typescript
interface TokenBudget {
  total: number;                    // e.g. 128000 (model context)
  reservedForCompletion: number;    // 20% minimum
  maxPromptTokens: number;          // total - reserved
  allocations: SectionAllocation[];
}

interface SectionAllocation {
  section: SectionType;
  maxTokens: number;                // hard ceiling
  priority: number;                 // Safety=100, System=90, Schema=80, Memory=60, Examples=30
  flexible: boolean;                // can be trimmed if over budget
}
```

**Allocation Algorithm:**
1. Assign each required section its `maxTokens` (hard ceiling)
2. If sum > `maxPromptTokens`, trim flexible sections by priority (lowest first)
3. Safety/System/Schema are never trimmed
4. If still over budget → error (prompt too large for model)

---

## 7. Prompt Versioning (Req #15)

```typescript
interface PromptVersion {
  major: number;      // Breaking: section order, required sections, schema changes
  minor: number;      // Additive: new optional sections, template improvements
  patch: number;      // Bug fixes: typo fixes, token optimization
  hash: string;       // Content hash for cache invalidation
}

interface VersionRegistry {
  register(template: PromptTemplate): PromptVersion;
  resolve(agent: AgentId, version: PromptVersion): PromptTemplate;
  latest(agent: AgentId): PromptTemplate;
}
```

---

## 8. Prompt Caching (Req #16)

```typescript
interface PromptCache {
  get(key: CacheKey): Promise<FinalPrompt | null>;
  set(key: CacheKey, prompt: FinalPrompt): Promise<void>;
  invalidate(key: CacheKey): Promise<void>;
  invalidatePrefix(prefix: string): Promise<void>;
}

interface CacheKey {
  agent: AgentId;
  templateVersion: PromptVersion;
  contextHash: string;      // hash of dynamic inputs (memory, workflow, task)
  schemaHash: string;       // hash of output schema
}
```

**Invalidation triggers:** template version change, schema change, memory superseded, safety rules updated.

---

## 8. Safety Layer (Req #13)

```typescript
interface Guardrail {
  id: string;
  type: "hard" | "soft";
  rule: string;                    // human-readable
  check: (prompt: string) => boolean;
  violationAction: "block" | "warn" | "rewrite";
}

interface SafetyLayer {
  check(prompt: string): SafetyResult;
  /** Prepend safety preamble to final prompt. */
  injectSafetyPreamble(prompt: string): string;
}

interface SafetyResult {
  passed: boolean;
  violations: GuardrailViolation[];
  rewrittenPrompt?: string;   // if action === "rewrite"
}
```

**Mandatory guardrails (from Brand Guidelines + config):**
- No fabricated claims without citation
- No PII in output
- Brand voice: confident, clear, grounded, expert-but-approachable
- No hype words (revolutionary, game-changing, unleash, supercharge)
- No empty intensifiers (very, really, extremely)
- Brand safety: no defamation, deception, off-brand content
- Platform policy compliance

---

## 9. Validation (Req #14)

```typescript
interface PromptValidator {
  /** Validate final prompt before sending to provider. */
  validate(prompt: FinalPrompt): ValidationResult;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  code: "OVER_BUDGET" | "MISSING_REQUIRED_SECTION" | "SCHEMA_INVALID" | "SAFETY_VIOLATION";
  message: string;
  section?: SectionType;
}
```

**Validation checks:**
1. All required sections present and non-empty
2. Total tokens ≤ budget
3. Output schema is valid JSON Schema
4. Safety layer passes
5. No unresolved template variables

---

## 9. Metrics (Req #20)

```typescript
interface CompilerMetrics {
  recordCompile(agent: AgentId, durationMs: number, tokens: number, cached: boolean): void;
  recordCacheHit(agent: AgentId): void;
  recordCacheMiss(agent: AgentId): void;
  recordValidationFailure(agent: AgentId, code: string): void;
  recordBudgetExceeded(agent: AgentId, overage: number): void;
  snapshot(): {
    avgCompileMs: number;
    cacheHitRate: number;
    avgTokens: number;
    budgetExceedRate: number;
  };
}
```

---

## 10. Integration Points

| Layer | Contract | Direction |
|---|---|---|
| **Runtime** | `PromptCompiler.assemble(PromptContext) → FinalPrompt` | Runtime → Compiler |
| **Memory Engine** | `MemoryEngine.retrieve()` → `LoadedMemory` | Compiler → Memory Engine |
| **Providers** | `GenerateRequest` carries `FinalPrompt.sections.map(s => s.content).join("\n\n")` | Compiler → Runtime → Provider |
| **Memory Engine** | `retrieve(query)` for Dynamic Memory Injection | Compiler → Memory Engine |
| **Company Brain** | `memory/company/README.md` + key docs | Compiler → File System (at build/deploy) |
| **Agent Brain** | `packages/agents/{agent}/brain.md` | Compiler → File System |
| **Output Schema** | `schemas/output.schema.json` per agent | Compiler → File System |
| **Safety** | `configs/environments/...`, `memory/company/brand-guidelines.md` | Compiler → Config |

---

## 11. Boundaries — What the Compiler Never Does

- **Never executes an LLM call** — it only builds the prompt string
- **Never decides which agent runs** — that's the Workflow Engine
- **Never stores memory** — it only retrieves via Memory Engine
- **Never calls a provider** — it only produces the final prompt string
- **Never makes business decisions** — it assembles, doesn't reason
- **Never hardcodes agent logic** — all agent-specific content comes from config/prompts

---

## 11. Related Documents

- [Runtime](../runtime/README.md) — the sole consumer of `PromptCompiler.assemble()`
- [Providers](../providers/README.md) — receives the final prompt
- [Memory Engine](../memory-engine/README.md) — supplies relevant memory
- [Company Brain](../../memory/company/README.md) — source of Company Brain section
- [Agent Contracts](../agents/README.md) — agent prompts, schemas, configs
- [Brand Guidelines](../../memory/company/brand-guidelines.md) — Safety Layer source
- [Workflows](../../workflows/README.md) — Workflow Context source
- [Observability](../../infra/monitoring/README.md) — metrics sink

---

## Status

Contracts and architecture only. No implementation. This is the specification a Prompt Compiler implementation will satisfy.

---

## Related Documents

- [Runtime](../runtime/README.md)
- [Providers](../providers/README.md)
- [Memory Engine](../memory-engine/README.md)
- [Workflow Engine](../workflow-engine/README.md)
- [Company Brain](../../memory/company/README.md)
- [Agent Contracts](../agents/README.md)
- [Brand Guidelines](../../memory/company/brand-guidelines.md)