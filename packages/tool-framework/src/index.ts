/**
 * @ai-media-factory/tool-framework — public contract surface.
 *
 * ARCHITECTURE ONLY. Re-exports the interface/type declarations that define
 * the Tool Execution Framework. No implementation is exported.
 *
 * The Runtime and Workflow Engine import from here and call ToolInvoker.invoke()
 * to execute tools through the framework. The framework handles all policy,
 * sandbox, retry, timeout, authentication, approval, and observability.
 * See ./README.md.
 */

// core - common primitives
export type {
  ToolId,
  AgentId,
  WorkflowId,
  StepId,
  InvocationId,
  ResultId,
  TraceId,
  CorrelationId,
  Timestamp,
  Approver,
  ProviderId,
  ToolCategory,
  Json,
  JsonSchema,
  Duration,
} from "./core/common.js";

// core - tool specification and interface (primary source for shared types)
export type {
  ToolPermission,
  AuthRequirement,
  SandboxLevel,
  SandboxConfig,
  ResourceLimits,
  RetryPolicyOverride,
  ToolSpec,
  ToolMetadata,
  Tool,
  ToolHealth,
  ToolInput,
  InvocationContext,
  CancellationToken,
  ResolvedCredentials,
  Certificate,
  ApprovalDecision,
  ToolErrorCode,
  ToolError,
  ExecutionMetadata,
  TokenUsage,
  SandboxInfo,
  ToolResult,
} from "./core/tool.js";

// core - tool implementation
export { BaseTool, createToolSpec, createInvocationContext, createCancellationToken } from "./core/tool-impl.js";

// registry
export type {
  ToolRegistry,
  ToolMetadata as RegistryToolMetadata,
  ValidationReport,
  ValidationError,
  ValidationWarning,
} from "./registry/registry.js";

export { DefaultToolRegistry } from "./registry/registry-impl.js";

// categories - unique types not in tool.ts
export type {
  CategoryConfig,
  CategoryRegistry,
  RetryPolicy as CategoryRetryPolicy,
} from "./categories/categories.js";

export { DEFAULT_CATEGORY_CONFIGS } from "./categories/categories.js";

// permissions
export type {
  Permission,
  PermissionPolicy,
  ConditionalPermission,
  PermissionContext,
  PermissionEvaluator,
} from "./permissions/permissions.js";

// policies
export type {
  ToolPolicy,
  TimeWindow,
  PolicyEvaluationRequest,
  PolicyDecision,
  PolicyOverride,
  PolicyEngine,
} from "./policies/policies.js";

// execution
export type { ToolInvoker } from "./execution/invocation.js";
export { DefaultToolInvoker } from "./execution/invoker.js";

// resilience
export type {
  RetryPolicy,
  ToolRetryPolicy,
  ToolError as RetryToolError,
} from "./resilience/retry.js";

export { DEFAULT_RETRY_POLICY } from "./resilience/retry.js";

export type {
  TimeoutController,
  TimeoutConfig,
  TimeoutState,
} from "./resilience/timeout.js";

export { DEFAULT_TIMEOUT_CONFIG } from "./resilience/timeout.js";

// sandbox - unique types not in tool.ts
export type {
  SandboxHandle,
  ToolSandbox,
} from "./sandbox/sandbox.js";

export { SANDBOX_LEVELS } from "./sandbox/sandbox.js";

// auth - unique types not in tool.ts
export type {
  CredentialResolver,
  AuthContext,
  CredentialStore,
} from "./auth/auth.js";

// gates - unique types not in tool.ts
export type {
  ApprovalGate,
  ApprovalRequest,
  ApprovalDecision as GateApprovalDecision,
  ApprovalContext,
  ApprovalRule,
} from "./gates/approval.js";

export { DEFAULT_APPROVAL_RULES } from "./gates/approval.js";

// results - all re-exported from tool.ts (ToolResult, ToolError, ToolErrorCode, ExecutionMetadata, TokenUsage, SandboxInfo)

// observability
export type { LogLevel, ToolLogger, InvocationLogEntry } from "./observability/logging.js";

export type { ToolMetrics, ToolMetricsSnapshot } from "./observability/metrics.js";

export type { CostTracker, CostBreakdown, TokenUsage as CostTokenUsage, CostEstimator } from "./observability/cost.js";

// capabilities - injectable boundary contracts (no implementations)
export type {
  CapabilityId,
  CapabilityPattern,
  CapabilityRequest,
  CapabilityResult,
  CapabilitySuccess,
  CapabilityBlocked,
  CapabilityFailure,
  CapabilityExecutorPort,
  CapabilityDescriptor,
  CapabilityAuthorization,
  CapabilityResolver,
  ExecutionEvidence,
} from "./capabilities.js";
