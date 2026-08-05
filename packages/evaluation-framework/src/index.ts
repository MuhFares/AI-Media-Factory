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
export * from "./core/common";
export * from "./core/engine";
export * from "./core/request";
// metrics
export * from "./metrics/metrics";
export * from "./metrics/scorecard";
// gates
export * from "./gates/gates";
// benchmarks
export * from "./benchmarks/benchmarks";
// regression
export * from "./regression/regression";
// leaderboards
export * from "./leaderboards/leaderboards";
// trends
export * from "./trends/trends";
// improvement
export * from "./improvement/improvement";
// reports
export * from "./reports/reports";