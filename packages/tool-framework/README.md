# Tool Framework (`@ai-media-factory/tool-framework`)

> Architecture specification for the Tool Execution Framework of AI Media Factory (AMF). **Contracts and architecture only** — the `src/**/*.ts` files are type/interface declarations with no implementation bodies. The Tool Framework is the **single authority** for executing external tools safely. The Runtime never calls tools directly; all tool execution goes through this framework.

## 0. Core Principle

**One framework, one policy, safe execution.** Every tool — whether it's a web search, file operation, API call, or code execution — goes through the Tool Framework. The Runtime never calls tools directly. The framework enforces permissions, policies, sandboxing, authentication, retries, timeouts, and approval gates uniformly across all tools.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        TOOL FRAMEWORK                                       │
├────────────────────────────────────────────────────────────────────────────┤
│  Agent / Runtime Requests Tool Execution                                   │
│         │                                                                   │
│         ▼                                                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ TOOL FRAMEWORK                                                         │  │
│  │  1. REGISTRY LOOKUP         → Validate tool exists & agent permitted  │  │
│  │  2. PERMISSION CHECK        → Agent allowed? Policy permits?          │  │
│  │  3. APPROVAL GATE           → Human/CEO approval if required          │  │
│  │  4. AUTHENTICATION          → Resolve credentials, inject tokens      │  │
│  │  5. SANDBOX PREPARATION     → Isolate execution environment           │  │
│  │  6. INVOCATION              → Execute tool in sandbox                 │  │
│  │  7. TIMEOUT ENFORCEMENT     → Enforce per-tool deadline               │  │
│  │  8. RETRY LOGIC             → Retry on transient failures             │  │
│  │  8. RESULT VALIDATION       → Validate against output schema          │  │
│  │  9. COST TRACKING           → Record tokens, latency, cost            │  │
│  │ 10. LOGGING & AUDIT         → Structured logs + audit trail           │  │
│  │ 11. RETURN RESULT           → Validated ToolResult to caller          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│         │                                                                   │
│         ▼                                                                   │
│  ToolResult returned to Runtime / Workflow Engine                          │
└────────────────────────────────────────────────────────────────────────────┘
```

**Dependency direction:** `runtime/workflow-engine → tool-framework`. The Tool Framework imports from `memory-engine` (for audit logging) but does not import from `runtime` or `workflow-engine`. One-way dependency.

---

## 1. The 15 Requirements → Where Each Lives

| # | Requirement | Home |
|---|---|---|
| 1 | Tool Registry | `registry/registry.ts` |
| 2 | Tool Interface | `core/tool.ts` |
| 3 | Tool Categories | `categories/categories.ts` |
| 4 | Tool Permissions | `permissions/permissions.ts` |
| 5 | Tool Policies | `policies/policies.ts` |
| 6 | Tool Invocation | `execution/invocation.ts` |
| 7 | Tool Results | `results/results.ts` |
| 8 | Tool Retry | `resilience/retry.ts` |
| 9 | Tool Timeout | `resilience/timeout.ts` |
| 10 | Tool Sandbox | `sandbox/sandbox.ts` |
| 11 | Tool Authentication | `auth/auth.ts` |
| 12 | Tool Logging | `observability/logging.ts` |
| 13 | Tool Metrics | `observability/metrics.ts` |
| 14 | Tool Cost Tracking | `observability/cost.ts` |
| 14 | Tool Approval Gates | `gates/approval.ts` |

---

## 2. Folder Structure

```
packages/tool-framework/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # barrel (types only)
    ├── core/
    │   ├── README.md
    │   ├── tool.ts                 # Tool interface, ToolSpec, ToolMetadata
    │   ├── execution.ts            # ToolInvocation, ToolExecutionContext
    │   └── result.ts               # ToolResult, ToolError
    ├── registry/
    │   ├── README.md
    │   └── registry.ts             # ToolRegistry
    ├── categories/
    │   ├── README.md
    │   └── categories.ts           # ToolCategory, CategoryRegistry
    ├── permissions/
    │   ├── README.md
    │   └── permissions.ts          # ToolPermissions, PermissionPolicy
    ├── policies/
    │   ├── README.md
    │   └── policies.ts             # ToolPolicy, PolicyEngine
    ├── execution/
    │   ├── README.md
    │   └── invocation.ts           # ToolInvoker, InvocationContext
    ├── resilience/
    │   ├── README.md
    │   ├── retry.ts                # ToolRetryPolicy
    │   └── timeout.ts              # TimeoutController
    ├── sandbox/
    │   ├── README.md
    │   └── sandbox.ts              # ToolSandbox, SandboxConfig
    ├── auth/
    │   ├── README.md
    │   └── auth.ts                 # ToolAuth, CredentialResolver
    ├── gates/
    │   ├── README.md
    │   └── approval.ts             # ApprovalGate, ApprovalRequest
    ├── results/
    │   ├── README.md
    │   └── results.ts              # ToolResult, ToolError
    ├── observability/
    │   ├── README.md
    │   ├── logging.ts              # ToolLogger
    │   ├── metrics.ts              # ToolMetrics
    │   └── cost.ts                 # CostTracker
    └── index.ts                    # barrel
```

---

## 3. Core Types

### 3.1 Tool Specification (What a Tool Is)

```typescript
interface ToolSpec {
  /** Unique tool identifier. */
  id: ToolId;
  /** Human-readable name. */
  name: string;
  /** Category this tool belongs to. */
  category: ToolCategory;
  /** Version of this tool spec. */
  version: string;
  /** Description of what the tool does. */
  description: string;
  /** Input schema (JSON Schema draft-07). */
  inputSchema: JsonSchema;
  /** Output schema (JSON Schema draft-07). */
  outputSchema: JsonSchema;
  /** Required permissions to invoke. */
  requiredPermissions: Permission[];
  /** Category for routing/logging. */
  category: ToolCategory;
  /** Timeout in milliseconds. */
  timeoutMs: number;
  /** Whether this tool requires approval before execution. */
  requiresApproval: boolean;
  /** Retry policy override. */
  retryPolicy?: RetryPolicyOverride;
  /** Sandbox configuration. */
  sandboxConfig?: SandboxConfig;
  /** Authentication requirements. */
  authRequirements: AuthRequirement[];
  /** Cost estimate per invocation (USD). */
  estimatedCostUsd: number;
  /** Whether this tool is deprecated. */
  deprecated?: boolean;
  /** Tags for discovery. */
  tags: string[];
}
```

### 3.2 Tool Interface (What a Tool Does)

```typescript
interface Tool {
  readonly spec: ToolSpec;
  /** Execute the tool with given input. */
  invoke(input: Json, context: InvocationContext): Promise<ToolResult>;
  /** Health check. */
  health(): Promise<ToolHealth>;
}
```

### 3.3 Tool Execution Context

```typescript
interface InvocationContext {
  /** Unique invocation ID. */
  invocationId: InvocationId;
  /** Agent requesting execution. */
  agent: AgentId;
  /** Workflow context (if applicable). */
  workflowId?: WorkflowId;
  stepId?: StepId;
  /** Correlation ID for tracing. */
  correlationId: CorrelationId;
  /** Trace ID for distributed tracing. */
  traceId: TraceId;
  /** Timeout deadline. */
  deadline: Timestamp;
  /** Approval decision (if approval required). */
  approvalDecision?: ApprovalDecision;
  /** Resolved credentials. */
  credentials: ResolvedCredentials;
  /** Sandbox configuration. */
  sandboxConfig: SandboxConfig;
  /** Cancellation token. */
  cancellationToken: CancellationToken;
}
```

### 3.3 Tool Result

```typescript
interface ToolResult {
  /** Unique result ID. */
  resultId: ResultId;
  /** Tool that produced this result. */
  toolId: ToolId;
  /** Whether execution succeeded. */
  success: boolean;
  /** Output data (validated against outputSchema). */
  output: Json;
  /** Error if failed. */
  error?: ToolError;
  /** Execution metadata. */
  metadata: ExecutionMetadata;
}

interface ExecutionMetadata {
  /** Tool that executed. */
  toolId: ToolId;
  /** Start time. */
  startedAt: Timestamp;
  /** End time. */
  completedAt: Timestamp;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Tokens consumed (if applicable). */
  tokensUsed?: TokenUsage;
  /** Cost in USD. */
  costUsd: number;
  /** Retry count. */
  retryCount: number;
  /** Whether result came from cache. */
  cached: boolean;
  /** Sandbox info. */
  sandboxInfo: SandboxInfo;
}
```

---

## 4. Tool Categories (Req #3)

```typescript
type ToolCategory =
  | "web_search"          // Web search, browsing
  | "api_call"            // HTTP API calls
  | "file_operation"      // Read/write/delete files
  | "code_execution"      // Code execution (Python, JS, etc.)
  | "data_processing"     // Data transformation, ETL
  | "media_generation"    // Image, video, audio generation
  | "media_processing"    // Video encoding, image processing
  | "communication"       // Email, Slack, webhooks
  | "database"            // Database queries
  | "analysis"            // Data analysis, ML inference
  | "authentication"      // OAuth, token management
  | "monitoring"          // Metrics, logging, alerting
  | "custom";             // Custom/other

interface CategoryRegistry {
  register(category: ToolCategory, config: CategoryConfig): void;
  getConfig(category: ToolCategory): CategoryConfig;
  listCategories(): ToolCategory[];
}

interface CategoryConfig {
  /** Default timeout for this category. */
  defaultTimeoutMs: number;
  /** Default retry policy. */
  defaultRetryPolicy: RetryPolicy;
  /** Requires approval by default? */
  requiresApprovalByDefault: boolean;
  /** Default sandbox isolation level. */
  defaultSandboxLevel: SandboxLevel;
  /** Cost per invocation estimate. */
  estimatedCostPerCallUsd: number;
}
```

---

## 4. Permissions (Req #4)

```typescript
type Permission =
  | "tool:web_search"
  | "tool:api_call"
  | "tool:file_read"
  | "tool:file_write"
  | "tool:code_exec"
  | "tool:media_generate"
  | "tool:api_call_external"
  | "tool:database_query"
  | "tool:media_process"
  | "tool:data_export"
  | "tool:admin"
  | string; // extensible

interface PermissionPolicy {
  /** Permissions granted to this agent. */
  granted: Permission[];
  /** Permissions explicitly denied. */
  denied: Permission[];
  /** Conditional permissions (context-dependent). */
  conditional: ConditionalPermission[];
}

interface ConditionalPermission {
  permission: Permission;
  condition: (context: PermissionContext) => boolean;
}

interface PermissionContext {
  agent: AgentId;
  toolId: ToolId;
  workflowId?: WorkflowId;
  stepId?: StepId;
  brandId?: BrandId;
  timeOfDay: Timestamp;
}
```

---

## 5. Policies (Req #5)

```typescript
interface ToolPolicy {
  /** Maximum concurrent executions of this tool. */
  maxConcurrency: number;
  /** Global rate limit (requests per minute). */
  rateLimitRpm?: number;
  /** Per-agent rate limit. */
  perAgentRateLimit?: number;
  /** Require approval for this tool. */
  requiresApproval: boolean;
  /** Approvers required. */
  approvers: Approver[];
  /** Cost ceiling per invocation. */
  maxCostUsd: number;
  /** Allowed time windows (cron-like). */
  allowedWindows?: TimeWindow[];
  /** Data residency requirements. */
  dataResidency?: string[];
}

interface PolicyEngine {
  /** Evaluate if a tool invocation is allowed under current policies. */
  evaluate(request: PolicyEvaluationRequest): PolicyDecision;
}

interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  requiredApprovals: Approver[];
  overrides: PolicyOverride[];
}
```

---

## 5. Execution Layer (Req #6, #8, #9)

### 4.1 Invocation

```typescript
interface ToolInvoker {
  /** Execute a tool with full framework pipeline. */
  invoke(toolId: ToolId, input: Json, context: InvocationContext): Promise<ToolResult>;
}

interface InvocationContext {
  invocationId: InvocationId;
  agent: AgentId;
  workflowId?: WorkflowId;
  stepId?: StepId;
  correlationId: CorrelationId;
  traceId: TraceId;
  deadline: Timestamp;
  approvalDecision?: ApprovalDecision;
  credentials: ResolvedCredentials;
  sandboxConfig: SandboxConfig;
  cancellationToken: CancellationToken;
}
```

### 4.2 Retry Policy (Req #8)

```typescript
interface RetryPolicy {
  maxAttempts: number;              // default: 3
  baseDelayMs: number;              // e.g., 1000
  maxDelayMs: number;               // e.g., 30000
  backoffMultiplier: number;        // e.g., 2.0
  jitter: boolean;                  // add randomness
  retryableErrors: string[];        // error codes/types to retry
  nonRetryableErrors: string[];     // error codes/types to never retry
}

interface ToolRetryPolicy {
  shouldRetry(error: ToolError, attempt: number): boolean;
  getDelay(attempt: number): number;
  readonly maxAttempts: number;
}
```

### 4.3 Timeout Controller (Req #9)

```typescript
interface TimeoutController {
  /** Run work with a deadline. */
  withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Get remaining time for an invocation. */
  getRemainingTime(invocationId: InvocationId): number;
}
```

---

## 5. Sandbox (Req #10)

```typescript
type SandboxLevel = "none" | "process" | "container" | "vm" | "wasm";

interface SandboxConfig {
  level: SandboxLevel;
  /** Memory limit in MB. */
  memoryLimitMb?: number;
  /** CPU time limit in seconds. */
  cpuTimeLimitSec?: number;
  /** Network access allowed? */
  networkAccess: boolean;
  /** Allowed network destinations. */
  allowedHosts?: string[];
  /** File system access. */
  filesystemAccess: "none" | "read" | "readwrite" | "temp_only";
  /** Allowed file paths. */
  allowedPaths?: string[];
  /** Environment variables. */
  envVars?: Record<string, string>;
  /** Resource limits. */
  resourceLimits?: ResourceLimits;
}

interface ToolSandbox {
  /** Prepare sandbox for execution. */
  prepare(config: SandboxConfig): Promise<SandboxHandle>;
  /** Execute within sandbox. */
  execute<T>(handle: SandboxHandle, fn: () => Promise<T>): Promise<T>;
  /** Cleanup sandbox. */
  cleanup(handle: SandboxHandle): Promise<void>;
}

interface SandboxHandle {
  sandboxId: string;
  processId?: number;
  containerId?: string;
  cleanup: () => Promise<void>;
}
```

---

## 5. Authentication (Req #11)

```typescript
type AuthRequirement =
  | { type: "none" }
  | { type: "api_key"; keyName: string }
  | { type: "oauth2"; provider: string; scopes: string[] }
  | { type: "bearer_token"; tokenName: string }
  | { type: "mTLS"; certName: string }
  | { type: "aws_iam"; roleArn: string }
  | { type: "gcp_iam"; serviceAccount: string }
  | { type: "custom"; handler: string };

interface CredentialResolver {
  /** Resolve credentials for a tool's auth requirements. */
  resolve(requirements: AuthRequirement[], context: AuthContext): Promise<ResolvedCredentials>;
}

interface ResolvedCredentials {
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyParams?: Record<string, string>;
  envVars?: Record<string, string>;
  certificates?: Certificate[];
}

interface AuthContext {
  agent: AgentId;
  toolId: ToolId;
  workflowId?: WorkflowId;
  environment: "development" | "staging" | "production";
}
```

---

## 6. Approval Gates (Req #15)

```typescript
interface ApprovalGate {
  /** Check if approval is required for this tool/invocation. */
  isApprovalRequired(toolId: ToolId, context: ApprovalContext): boolean;
  
  /** Request approval (async, may wait for human). */
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
  
  /** Apply a decision to a pending invocation. */
  applyDecision(decision: ApprovalDecision): Promise<void>;
}

interface ApprovalRequest {
  invocationId: InvocationId;
  toolId: ToolId;
  agent: AgentId;
  workflowId?: WorkflowId;
  input: Json;
  reason: string;
  urgency: "low" | "normal" | "high" | "critical";
  expiresAt: Timestamp;
}

interface ApprovalDecision {
  invocationId: InvocationId;
  approved: boolean;
  approver: AgentId;
  reason: string;
  conditions?: string[];
  decidedAt: Timestamp;
}

interface ApprovalContext {
  toolId: ToolId;
  agent: AgentId;
  workflowId?: WorkflowId;
  input: Json;
  estimatedCostUsd: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}
```

---

## 6. Results & Errors (Req #7)

```typescript
interface ToolResult {
  resultId: ResultId;
  toolId: ToolId;
  success: boolean;
  output: Json;
  error?: ToolError;
  metadata: ExecutionMetadata;
}

interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: Json;
  cause?: ToolError;
}

type ToolErrorCode =
  | "VALIDATION_ERROR"      // Input/output validation failed
  | "PERMISSION_DENIED"     // Agent lacks permission
  | "APPROVAL_REJECTED"     // Approval gate rejected
  | "TIMEOUT"               // Execution timeout
  | "SANDBOX_ERROR"         // Sandbox failure
  | "AUTHENTICATION_ERROR"  // Auth failure
  | "RATE_LIMITED"          // Rate limit exceeded
  | "PROVIDER_ERROR"        // Upstream provider error
  | "VALIDATION_ERROR"      // Output schema validation failed
  | "SANDBOX_VIOLATION"     // Sandbox escape attempt
  | "COST_EXCEEDED"         // Cost ceiling exceeded
  | "UNKNOWN";              // Unknown error
```

---

## 7. Observability (Req #12, #13, #14)

### 7.1 Logging

```typescript
interface ToolLogger {
  logInvocation(invocation: InvocationLogEntry): void;
  logResult(result: ToolResult): void;
  logError(error: ToolError, context: InvocationContext): void;
}

interface InvocationLogEntry {
  invocationId: InvocationId;
  toolId: ToolId;
  agent: AgentId;
  workflowId?: WorkflowId;
  inputHash: string;      // Hash of input (no secrets)
  startedAt: Timestamp;
  status: "started" | "completed" | "failed" | "cancelled";
}
```

### 7.2 Metrics

```typescript
interface ToolMetrics {
  recordInvocation(toolId: ToolId, durationMs: number, success: boolean): void;
  recordRetry(toolId: ToolId, attempt: number): void;
  recordTimeout(toolId: ToolId): void;
  recordApproval(toolId: ToolId, approved: boolean): void;
  recordCost(toolId: ToolId, costUsd: number): void;
  recordTokens(toolId: ToolId, inputTokens: number, outputTokens: number): void;
  snapshot(): ToolMetricsSnapshot;
}

interface ToolMetricsSnapshot {
  totalInvocations: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  retryRate: number;
  timeoutRate: number;
  approvalRate: number;
  avgCostUsd: number;
  totalCostUsd: number;
}
```

### 7.3 Cost Tracking

```typescript
interface CostTracker {
  recordCost(toolId: ToolId, costUsd: number, agent: AgentId): void;
  getTotalCost(agent?: AgentId, toolId?: ToolId, since?: Timestamp): number;
  getCostBreakdown(agent: AgentId, since: Timestamp): CostBreakdown;
}

interface CostBreakdown {
  byTool: Record<ToolId, number>;
  byCategory: Record<ToolCategory, number>;
  total: number;
}
```

---

## 5. Tool Registry (Req #1)

```typescript
interface ToolRegistry {
  register(tool: Tool): void;
  unregister(toolId: ToolId): void;
  get(toolId: ToolId): Tool | null;
  getByCategory(category: ToolCategory): Tool[];
  getByAgent(agent: AgentId): Tool[];  // tools agent is permitted to use
  all(): Tool[];
  /** Validate all registered tools have valid specs. */
  validate(): ValidationReport;
}

interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
```

---

## 7. Boundaries — What the Tool Framework Never Does

- **Never executes business logic** — only executes registered tools
- **Never makes approval decisions** — only enforces approval gates
- **Never stores credentials** — resolves at invocation time via CredentialResolver
- **Never bypasses sandbox** — all execution is sandboxed
- **Never bypasses approval gates** — approval is mandatory when required
- **Never logs secrets** — input/output sanitized before logging
- **Never bypasses rate limits/cost ceilings** — hard enforcement

---

## Status

Contracts and architecture only. No implementation. This is the specification a Tool Framework implementation will satisfy.

## Related Documents

- [Runtime](../runtime/README.md) — consumer of Tool Framework
- [Workflow Engine](../workflow-engine/README.md) — consumer of Tool Framework
- [Providers](../providers/README.md) — some tools may use providers
- [Memory Engine](../memory-engine/README.md) — audit logging
- [Event Bus](../../docs/architecture/event-bus.md) — event transport
- [Security](../../docs/architecture/security.md) — sandbox, auth details