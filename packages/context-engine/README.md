# Context Engine (`@ai-media-factory/context-engine`)

> Architecture specification for the Context Engine of AI Media Factory (AMF). **Contracts and architecture only** — the `src/**/*.ts` files are type/interface declarations with no implementation bodies. The Context Engine is the **single authority** for deciding what context an agent receives before every execution. It sits between the Memory Engine, Workflow Engine, and Prompt Compiler/Runtime.

## 0. Core Principle

**One engine, one decision, optimal context.** The Context Engine is the **single authority** for what context an agent receives before every execution. It sits between the Memory Engine, Workflow Engine, and Prompt Compiler/Runtime, deciding exactly what context each agent receives to **minimize tokens while maximizing decision quality**.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        CONTEXT ENGINE                                        │
├────────────────────────────────────────────────────────────────────────────┤
│  Inputs (from Runtime/Workflow Engine)                                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│  │ Agent Config│ │ Workflow    │ │ Agent State │ │ Execution History   │  │
│  │ (agent id,  │ │ Context     │ │ (memory,    │ │ (past turns,        │  │
│  │  role, etc) │ │ (workflow   │ │  brain, etc) │ │  outcomes)        │  │
│  └─────────────┘ │  id, step)  │ └─────────────┘ └─────────────────────┘  │
└────────┬─────────┴──────┬────────┴────────┬────────┴────────┬────────────┘
         │                │                 │                 │
         ▼                ▼                 ▼                 ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     CONTEXT ENGINE PIPELINE                                 │
├────────────────────────────────────────────────────────────────────────────┤
│  1. CONTEXT REQUEST          →  Validate & normalize input                │
│  2. BRAIN SELECTION          →  Company Brain? Agent Brain? Both?         │
│  3. CONTEXT SELECTION        →  Retrieval Rules + Freshness + Relevance   │
│  4. PRIORITY RANKING         →  Memory Priority + Confidence + Freshness  │
│  5. TOKEN BUDGETING          →  Allocate tokens across sections           │
│  6. COMPRESSION              →  Summarize / deduplicate / truncate        │
│  7. CONTEXT ASSEMBLY         →  Build final ContextPackage                │
│  8. CACHE CHECK              →  Return cached if valid                    │
└────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   CONTEXT PACKAGE   │  →  Sent to Prompt Compiler
                    └─────────────────────┘
```

**Dependency direction:** `runtime/workflow-engine → context-engine`. The Context Engine imports from `memory-engine` and `workflow-engine` types, but those layers do not import from context-engine. One-way dependency.

---

## 1. The 13 Requirements → Where Each Lives

| # | Requirement | Home |
|---|---|---|
| 1 | Context Selection | `selection/selector.ts` |
| 2 | Context Ranking | `ranking/ranker.ts` |
| 3 | Context Compression | `compression/compressor.ts` |
| 4 | Token Budget | `budget/budget.ts` |
| 5 | Memory Priority | `priority/priority.ts` |
| 6 | Brain Selection | `brain/selector.ts` |
| 7 | Workflow Context | `context/workflow.ts` |
| 8 | Session Context | `context/session.ts` |
| 9 | Retrieval Rules | `rules/retrieval.ts` |
| 10 | Freshness Rules | `rules/freshness.ts` |
| 11 | Relevance Scoring | `scoring/relevance.ts` |
| 12 | Confidence Thresholds | `thresholds/thresholds.ts` |
| 13 | Context Cache | `cache/cache.ts` |
| 13 | Context Metrics | `observability/metrics.ts` |

---

## 2. Folder Structure

```
packages/context-engine/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # barrel (types only)
    ├── core/
    │   ├── README.md
    │   ├── engine.ts               # ContextEngine interface
    │   ├── request.ts              # ContextRequest, ContextPackage
    │   └── result.ts               # ContextResult
    ├── brain/
    │   ├── README.md
    │   └── selector.ts             # BrainSelector (Company vs Agent)
    ├── context/
    │   ├── README.md
    │   ├── workflow.ts             # WorkflowContextPackage
    │   ├── session.ts              # SessionContextPackage
    │   ├── agent-brain.ts          # AgentBrainPackage
    │   └── company-brain.ts        # CompanyBrainPackage
    ├── selection/
    │   ├── README.md
    │   └── selector.ts             # ContextSelector
    ├── rules/
    │   ├── README.md
    │   ├── retrieval.ts            # RetrievalRules
    │   ├── freshness.ts            # FreshnessRules
    │   └── relevance.ts            # RelevanceScoring
    ├── ranking/
    │   ├── README.md
    │   └── ranker.ts               # ContextRanker
    ├── compression/
    │   ├── README.md
    │   ├── compressor.ts           # ContextCompressor
    │   └── budget.ts               # TokenBudget, MemoryPriority
    ├── thresholds/
    │   ├── README.md
    │   └── thresholds.ts           # ConfidenceThresholds
    ├── cache/
    │   ├── README.md
    │   └── cache.ts                # ContextCache
    ├── observability/
    │   ├── README.md
    │   └── metrics.ts              # ContextMetrics
    ├── cache/
    │   └── cache.ts                # ContextCache
    └── index.ts                    # barrel
```

---

## 2. Core Types

### 2.1 Context Request (Input)

```typescript
interface ContextRequest {
  agent: AgentId;                    // Which agent is requesting context
  workflowId: WorkflowId | null;     // Current workflow (if any)
  stepId: StepId | null;             // Current step (if in workflow)
  turnId: TurnId;                    // Current turn ID
  trigger: ContextTrigger;           // Why context is needed
  /** Override defaults for this request. */
  overrides?: ContextOverrides;
}

interface ContextOverrides {
  /** Force include specific memory types. */
  forceInclude?: MemoryType[];
  /** Exclude specific memory types. */
  exclude?: MemoryType[];
  /** Override token budget for this request. */
  tokenBudgetOverride?: number;
  /** Force include specific memory IDs. */
  forceIncludeIds?: MemoryId[];
  /** Minimum confidence threshold (0..1). */
  minConfidence?: number;
}

type ContextTrigger = 
  | "turn_start"        // Normal turn start
  | "retry"             // Retrying a failed step
  | "rework"            // Rework after gate failure
  | "recovery"          // Recovery from checkpoint
  | "manual_override";  // Manual trigger
```

### 2.2 Context Package (Output)

```typescript
interface ContextPackage {
  /** Unique ID for this context package. */
  packageId: PackageId;
  /** The agent this package is for. */
  agent: AgentId;
  /** Timestamp when package was created. */
  createdAt: Timestamp;
  
  /** Company Brain section (always included). */
  companyBrain: CompanyBrainSection;
  /** Agent Brain section (always included). */
  agentBrain: AgentBrainSection;
  /** Workflow context (if in workflow). */
  workflowContext?: WorkflowContextSection;
  /** Session context (always included). */
  sessionContext: SessionContextSection;
  /** Relevant memory (RAG results). */
  memory: MemorySection;
  /** Agent brain (role, KPIs, authority). */
  agentBrain: AgentBrainSection;
  /** Workflow context (if applicable). */
  workflowContext?: WorkflowContextSection;
  /** Few-shot examples. */
  examples?: ExamplesSection;
  /** Current task/input. */
  task: TaskSection;
  /** Output schema. */
  outputSchema: SchemaSection;
  /** Safety/guardrails. */
  safety: SafetySection;
  
  /** Total tokens in this package. */
  totalTokens: number;
  /** Token budget used. */
  budgetUsed: number;
  /** Whether any section was compressed. */
  compressed: boolean;
  /** Cache info. */
  cacheInfo: CacheInfo;
}

interface CacheInfo {
  hit: boolean;
  cacheKey: CacheKey;
  ageMs: number;
}
```

---

## 3. Brain Selection (Req #6)

The engine decides which brains to include based on agent role and task:

```typescript
interface BrainSelector {
  /** Select which brains to include for this agent/task. */
  selectBrains(request: ContextRequest): BrainSelection;
}

interface BrainSelection {
  /** Always included. */
  companyBrain: true;
  /** Always included. */
  agentBrain: true;
  /** Included if in workflow. */
  workflowContext?: boolean;
  /** Included if agent has session. */
  sessionContext?: boolean;
  /** Optional: only if relevant to task. */
  examples?: boolean;
}
```

**Selection Rules:**
| Agent | Company Brain | Agent Brain | Workflow Context | Session Context |
|---|---|---|---|---|
| CEO | ✓ | ✓ | ✓ (always) | ✓ |
| Orchestrator | ✓ | ✓ | ✓ | ✓ |
| Research/Writer/SEO/etc | ✓ | ✓ | ✓ | ✓ |
| QA/Brand | ✓ | ✓ | ✓ | ✓ |
| Publisher | ✓ | ✓ | ✓ | ✓ |

---

## 3. Context Types (Req #7, #8)

### 3.1 Company Brain Section

```typescript
interface CompanyBrainSection {
  /** Company vision (from memory/company/vision.md). */
  vision: string;
  /** Company mission (from memory/company/mission.md). */
  mission: string;
  /** Core values (from memory/company/values.md). */
  values: string[];
  /** North Star Metric definition. */
  northStar: NorthStarMetric;
  /** Decision framework summary. */
  decisionFramework: string;
  /** KPIs. */
  kpis: string;
  /** Brand guidelines summary. */
  brandGuidelines: string;
  /** Token count. */
  tokens: number;
}
```

### 3.2 Agent Brain Section

```typescript
interface AgentBrainSection {
  /** Agent ID. */
  agent: AgentId;
  /** Role description. */
  role: string;
  /** Key responsibilities. */
  responsibilities: string[];
  /** KPIs this agent owns. */
  kpis: string[];
  /** Decision authority scope. */
  authority: DecisionAuthority;
  /** Escalation rules. */
  escalationRules: string;
  /** Tokens. */
  tokens: number;
}
```

### 3.3 Workflow Context Section

```typescript
interface WorkflowContextSection {
  workflowId: WorkflowId;
  correlationId: CorrelationId | null;
  brandId: BrandId | null;
  currentStep: StepId;
  /** Completed step outputs relevant to current task. */
  relevantOutputs: Record<StepId, Json>;
  /** Current workflow data bag. */
  data: Record<string, Json>;
  tokens: number;
}
```

### 3.4 Session Context Section

```typescript
interface SessionContextSection {
  turnId: TurnId;
  workflowId: WorkflowId | null;
  agent: AgentId;
  /** Short-term scratch memory for this turn. */
  scratch: Json;
  /** Recent events in this session. */
  recentEvents: EventSummary[];
  tokens: number;
}
```

---

## 4. Context Selection & Ranking (Req #1, #2, #9, #10, #11)

### 4.1 Retrieval Rules (Req #9)

```typescript
interface RetrievalRules {
  /** Maximum memory records to retrieve per type. */
  maxPerType: Record<MemoryType, number>;
  /** Minimum relevance score (0..1). */
  minRelevance: number;
  /** Minimum confidence (0..1). */
  minConfidence: number;
  /** Required capabilities for retrieved memory. */
  requiredCapabilities?: Capability[];
  /** Boost recent memory? */
  recencyBoost: boolean;
  /** Diversity factor (0..1) to avoid duplicates. */
  diversityFactor: number;
}
```

### 4.2 Freshness Rules (Req #10)

```typescript
interface FreshnessRules {
  /** Max age for memory to be considered "fresh" by type. */
  maxAgeByType: Record<MemoryType, Duration>;
  /** Decay function for relevance over time. */
  decayFunction: "linear" | "exponential" | "step";
  /** Half-life for exponential decay (days). */
  halfLifeDays: number;
  /** Never expire these types (permanent). */
  neverExpire: MemoryType[];
}
```

### 4.3 Relevance Scoring (Req #11)

```typescript
interface RelevanceScorer {
  /** Score a memory record for relevance to query. */
  score(record: MemoryRecord, query: RetrievalQuery): RelevanceScore;
}

interface RelevanceScore {
  /** 0..1 overall relevance. */
  score: number;
  /** Breakdown of factors. */
  factors: {
    semanticSimilarity: number;    // Vector similarity
    graphProximity: number;        // Graph distance
    keywordMatch: number;          // Keyword overlap
    recency: number;               // Freshness
    performance: number;           // Past outcome quality
    confidence: number;            // Source confidence
  };
  /** Explanation for debugging. */
  explanation: string;
}
```

### 4.3 Context Selector (Req #1)

```typescript
interface ContextSelector {
  /** Select relevant context for a request. */
  select(request: ContextRequest): Promise<SelectionResult>;
}

interface SelectionResult {
  /** Retrieved memory records. */
  memory: LoadedMemory;
  /** Workflow context (if applicable). */
  workflowContext?: WorkflowContextSection;
  /** Session context. */
  sessionContext: SessionContextSection;
  /** Applied rules summary. */
  rulesApplied: RetrievalRules;
  /** Ranking applied. */
  ranking: RankingSummary;
}
```

### 4.4 Context Ranker (Req #2)

```typescript
interface ContextRanker {
  /** Rank memory records by composite score. */
  rank(records: MemoryRecord[], query: RetrievalQuery, rules: RetrievalRules): RankedRecord[];
}

interface RankedRecord {
  record: MemoryRecord;
  score: number;
  signals: RankSignals;
}

interface RankSignals {
  relevance: number;
  freshness: number;
  confidence: number;
  priority: number;
  performance: number;
}
```

---

## 5. Token Budget & Compression (Req #3, #4, #5)

### 5.1 Token Budget (Req #4)

```typescript
interface TokenBudget {
  /** Total context window of the model. */
  modelContextWindow: number;
  /** Minimum tokens reserved for model completion. */
  reservedForCompletion: number;
  /** Maximum tokens for the prompt (context window - reserved). */
  maxPromptTokens: number;
  /** Per-section allocations. */
  allocations: SectionBudget[];
}

interface SectionBudget {
  section: SectionType;
  maxTokens: number;
  priority: number;        // Higher = protected from trimming
  flexible: boolean;       // Can be trimmed
  minTokens: number;       // Minimum viable tokens
}
```

### 5.2 Memory Priority (Req #5)

```typescript
interface MemoryPriority {
  /** Base priority by memory type. */
  typePriority: Record<MemoryType, number>;
  /** Boost for high-confidence memories. */
  confidenceBoost: (confidence: number) => number;
  /** Boost for recent memories. */
  recencyBoost: (ageDays: number) => number;
  /** Boost for high-performance memories. */
  performanceBoost: (performanceScore: number) => number;
  /** Penalty for superseded/conflicted memories. */
  conflictPenalty: (conflictSeverity: number) => number;
}
```

### 5.2 Context Compressor (Req #3)

```typescript
interface ContextCompressor {
  /** Compress a context package to fit within token budget. */
  compress(pkg: ContextPackage, budget: TokenBudget): Promise<CompressionResult>;
}

interface CompressionResult {
  compressedPackage: ContextPackage;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  /** Sections that were compressed. */
  compressedSections: SectionType[];
  /** Summaries generated during compression. */
  summariesGenerated: Summary[];
}

interface Summary {
  sourceIds: MemoryId[];
  summary: string;
  tokens: number;
  confidence: number;
}
```

**Compression Strategies (in order):**
1. **Deduplicate** — remove near-duplicate memories
2. **Summarize** — collapse similar memories into summaries
3. **Trim examples** — reduce example count
3. **Trim memory** — drop lowest-priority memories
4. **Truncate workflow context** — keep only relevant outputs
5. **Last resort** — truncate company/agent brain (never safety)

---

## 6. Confidence Thresholds (Req #12)

```typescript
interface ConfidenceThresholds {
  /** Minimum confidence for memory to be included. */
  minMemoryConfidence: number;
  /** Minimum confidence for lesson to be applied. */
  minLessonConfidence: number;
  /** Minimum confidence for autonomous action. */
  minAutonomyConfidence: number;
  /** Confidence below which human review is required. */
  humanReviewThreshold: number;
  /** Decay rate per day for memory confidence. */
  dailyDecayRate: number;
}
```

---

## 7. Context Cache (Req #13)

```typescript
interface ContextCache {
  get(key: CacheKey): Promise<ContextPackage | null>;
  set(key: CacheKey, pkg: ContextPackage): Promise<void>;
  invalidate(key: CacheKey): Promise<void>;
  invalidatePrefix(prefix: string): Promise<void>;
  invalidateAgent(agent: AgentId): Promise<void>;
  stats(): CacheStats;
}

interface CacheKey {
  agent: AgentId;
  workflowId: WorkflowId | null;
  stepId: StepId | null;
  trigger: ContextTrigger;
  contextHash: string;      // Hash of selection inputs
  budgetHash: string;       // Hash of budget parameters
}

interface CacheStats {
  size: number;
  hitRate: number;
  missRate: number;
  evictionRate: number;
  avgAgeMs: number;
}
```

**Cache Invalidation Triggers:**
| Event | Invalidation |
|---|---|
| Memory superseded/updated | Invalidate affected agent/workflow |
| New lesson promoted | Invalidate relevant agents |
| Workflow context changed | Invalidate workflow |
| Budget params changed | Invalidate all |
| Template/schema change | Invalidate all |

---

## 7. Context Metrics (Req #14)

```typescript
interface ContextMetrics {
  /** Context package size distribution. */
  recordPackageSize(agent: AgentId, tokens: number): void;
  /** Compression ratio. */
  recordCompression(original: number, compressed: number): void;
  /** Cache hit/miss. */
  recordCacheHit(): void;
  recordCacheMiss(): void;
  /** Selection latency. */
  recordSelectionLatency(ms: number): void;
  /** Compression ratio. */
  recordCompressionRatio(ratio: number): void;
  /** Token budget utilization. */
  recordBudgetUtilization(used: number, max: number): void;
  /** Relevance score distribution. */
  recordRelevanceScore(score: number): void;
  snapshot(): ContextMetricsSnapshot;
}

interface ContextMetricsSnapshot {
  avgPackageTokens: number;
  avgCompressionRatio: number;
  cacheHitRate: number;
  avgSelectionLatencyMs: number;
  avgRelevanceScore: number;
  budgetUtilizationPct: number;
}
```

---

## 8. Integration Points

| Consumer | Interface | Purpose |
|---|---|---|
| **Runtime** | `ContextEngine.buildContext(request)` | Get context for agent turn |
| **Workflow Engine** | `ContextEngine.buildContext(request)` | Get context for workflow steps |
| **Prompt Compiler** | Receives `ContextPackage` → builds prompt | Compiler consumes context package |
| **Memory Engine** | `MemoryEngine.retrieve()` | Context Engine calls for retrieval |
| **Workflow Engine** | Provides `WorkflowContext` | Context Engine consumes |

---

## 8. Boundaries — What the Context Engine Never Does

- **Never executes LLM calls** — only assembles context
- **Never decides which agent runs** — Workflow Engine does that
- **Never modifies memory directly** — only reads via Memory Engine
- **Never makes business decisions** — only optimizes context for decisions
- **Never hardcodes agent logic** — all agent-specific behavior via config

---

## Status

Contracts and architecture only. No implementation. This is the specification a Context Engine implementation will satisfy.

## Related Documents

- [Memory Engine](../memory-engine/README.md) — provides memory retrieval
- [Workflow Engine](../workflow-engine/README.md) — provides workflow context
- [Prompt Compiler](../prompt-compiler/README.md) — consumes context packages
- [Runtime](../runtime/README.md) — consumer of context packages
- [Memory Architecture](../../docs/architecture/memory-architecture.md) — memory type definitions
- [Company Brain](../../memory/company/README.md) — source of Company Brain

---

## Status

Contracts and architecture only. No implementation. This is the specification a Context Engine implementation will satisfy.