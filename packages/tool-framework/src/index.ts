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

// core
export * from "./core/common";
export * from "./core/tool";
export * from "./core/execution";
export * from "./core/tool";
// registry
export * from "./registry/registry";
// categories
export * from "./categories/categories";
// permissions
export * from "./permissions/permissions";
// policies
export * from "./policies/policies";
// execution
export * from "./execution/invocation";
// resilience
export * from "./resilience/retry";
export * from "./resilience/timeout";
// sandbox
export * from "./sandbox/sandbox";
// auth
export * from "./auth/auth";
// gates
export * from "./gates/approval";
// results
export * from "./results/results";
// observability
export * from "./observability/logging";
export * from "./observability/metrics";
export * from "./observability/cost";