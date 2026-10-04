/**
 * @ai-media-factory/prompt-compiler — public contract surface.
 *
 * ARCHITECTURE ONLY. Re-exports the interface/type declarations that define
 * the Prompt Compiler. No implementation is exported.
 *
 * The Runtime imports from here and calls PromptCompiler.assemble() to get
 * the final prompt string for the Provider Layer.
 * See ./README.md.
 */

// core
export * from "./core/common.js";
export * from "./core/context.js";
export * from "./core/compiler.js";
export * from "./core/builder.js";
export * from "./core/template.js";
// sections
export * from "./sections/sections.js";
export * from "./sections/ordering.js";
// budget
export * from "./budget/budget.js";
// injection
export * from "./injection/memory.js";
export * from "./injection/company.js";
export * from "./injection/agent.js";
export * from "./injection/workflow.js";
export * from "./injection/schema.js";
export * from "./injection/examples.js";
// safety
export * from "./safety/safety.js";
// validation
export * from "./validation/validation.js";
// versioning
export { type VersionPolicy } from "./versioning/versioning.js";
// caching
export * from "./caching/cache.js";
// observability
export * from "./observability/metrics.js";
