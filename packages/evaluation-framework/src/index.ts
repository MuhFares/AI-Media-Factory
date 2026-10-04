/**
 * @ai-media-factory/evaluation-framework — public contract surface.
 *
 * ARCHITECTURE ONLY. Re-exports the interface/type declarations that define
 * the Evaluation Framework — the Quality Operating System of AI Media Factory.
 * No implementation is exported.
 *
 * This framework continuously evaluates the entire AI Media Factory:
 * Agents, Providers, Workflows, Prompts, Memory, Tools, Outputs.
 *
 * See ./README.md.
 */

// core
export * from "./core/common.js";
export * from "./core/engine.js";
export * from "./core/request.js";
// metrics
export * from "./metrics/metrics.js";
// gates
export * from "./gates/gates.js";
// benchmarks
export * from "./benchmarks/benchmarks.js";
// regression
export * from "./regression/regression.js";
// leaderboards
export * from "./leaderboards/leaderboards.js";
// trends
export * from "./trends/trends.js";
// improvement
export * from "./improvement/improvement.js";
// reports
export * from "./reports/reports.js";
