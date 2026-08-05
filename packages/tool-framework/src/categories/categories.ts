/**
 * Tool Categories (Req #3).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export type ToolCategory =
  | "web_search"
  | "api_call"
  | "file_operation"
  | "code_execution"
  | "data_processing"
  | "media_generation"
  | "media_processing"
  | "communication"
  | "database"
  | "analysis"
  | "authentication"
  | "monitoring"
  | "custom";

export interface CategoryConfig {
  defaultTimeoutMs: number;
  defaultRetryPolicy: RetryPolicy;
  requiresApprovalByDefault: boolean;
  defaultSandboxLevel: SandboxLevel;
  estimatedCostPerCallUsd: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors: string[];
  nonRetryableErrors: string[];
}

export type SandboxLevel = "none" | "process" | "container" | "vm" | "wasm";

export interface CategoryRegistry {
  register(category: string, config: CategoryConfig): void;
  getConfig(category: string): CategoryConfig;
  listCategories(): string[];
}

export const DEFAULT_CATEGORY_CONFIGS: Record<string, CategoryConfig> = {
  web_search: {
    defaultTimeoutMs: 30000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2, jitter: true, retryableErrors: ["RATE_LIMITED", "TIMEOUT", "SERVER_ERROR"], nonRetryableErrors: ["VALIDATION_ERROR", "PERMISSION_DENIED"] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "process",
    estimatedCostPerCallUsd: 0.01,
  },
  api_call: {
    defaultTimeoutMs: 60000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2, jitter: true, retryableErrors: ["RATE_LIMITED", "TIMEOUT", "SERVER_ERROR"], nonRetryableErrors: ["VALIDATION_ERROR", "PERMISSION_DENIED", "AUTHENTICATION_ERROR"] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "process",
    estimatedCostPerCallUsd: 0.001,
  },
  file_operation: {
    defaultTimeoutMs: 30000,
    defaultRetryPolicy: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "IO_ERROR"], nonRetryableErrors: ["PERMISSION_DENIED", "NOT_FOUND"] },
    requiresApprovalByDefault: true,
    defaultSandboxLevel: "container",
    estimatedCostPerCallUsd: 0.0001,
  },
  code_execution: {
    defaultTimeoutMs: 120000,
    defaultRetryPolicy: { maxAttempts: 2, baseDelayMs: 2000, maxDelayMs: 30000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "OOM"], nonRetryableErrors: ["COMPILATION_ERROR", "RUNTIME_ERROR"] },
    requiresApprovalByDefault: true,
    defaultSandboxLevel: "container",
    estimatedCostPerCallUsd: 0.01,
  },
  data_processing: {
    defaultTimeoutMs: 60000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 20000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "OOM"], nonRetryableErrors: ["VALIDATION_ERROR"] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "container",
    estimatedCostPerCallUsd: 0.005,
  },
  media_generation: {
    defaultTimeoutMs: 180000,
    defaultRetryPolicy: { maxAttempts: 2, baseDelayMs: 5000, maxDelayMs: 60000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "OOM", "GPU_ERROR"], nonRetryableErrors: ["CONTENT_FILTER", "VALIDATION_ERROR"] },
    requiresApprovalByDefault: true,
    defaultSandboxLevel: "container",
    estimatedCostPerCallUsd: 0.50,
  },
  media_processing: {
    defaultTimeoutMs: 120000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 60000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "OOM", "ENCODING_ERROR"], nonRetryableErrors: ["FORMAT_ERROR", "CORRUPT_INPUT"] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "container",
    estimatedCostPerCallUsd: 0.10,
  },
  communication: {
    defaultTimeoutMs: 15000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 10000, backoffMultiplier: 2, jitter: true, retryableErrors: ["RATE_LIMITED", "TIMEOUT"], nonRetryableErrors: ["PERMISSION_DENIED", "INVALID_RECIPIENT"] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "process",
    estimatedCostPerCallUsd: 0.001,
  },
  database: {
    defaultTimeoutMs: 30000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "DEADLOCK"], nonRetryableErrors: ["SYNTAX_ERROR", "CONSTRAINT_VIOLATION"] },
    requiresApprovalByDefault: true,
    defaultSandboxLevel: "container",
    estimatedCostPerCallUsd: 0.001,
  },
  analysis: {
    defaultTimeoutMs: 60000,
    defaultRetryPolicy: { maxAttempts: 2, baseDelayMs: 2000, maxDelayMs: 30000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "OOM"], nonRetryableErrors: ["VALIDATION_ERROR", "MODEL_ERROR"] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "container",
    estimatedCostPerCallUsd: 0.05,
  },
  authentication: {
    defaultTimeoutMs: 10000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "RATE_LIMITED"], nonRetryableErrors: ["INVALID_CREDENTIALS", "PERMISSION_DENIED"] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "process",
    estimatedCostPerCallUsd: 0.0001,
  },
  monitoring: {
    defaultTimeoutMs: 15000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "UNAVAILABLE"], nonRetryableErrors: [] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "process",
    estimatedCostPerCallUsd: 0.0001,
  },
  custom: {
    defaultTimeoutMs: 60000,
    defaultRetryPolicy: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2, jitter: true, retryableErrors: ["TIMEOUT", "SERVER_ERROR"], nonRetryableErrors: [] },
    requiresApprovalByDefault: false,
    defaultSandboxLevel: "process",
    estimatedCostPerCallUsd: 0.01,
  },
};