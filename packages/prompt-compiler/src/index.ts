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
export * from "./core/common";
export * from "./core/context";
export * from "./core/compiler";
export * from "./core/builder";
export * from "./core/template";
// sections
export * from "./sections/sections";
export * from "./sections/ordering";
// budget
export * from "./budget/budget";
// injection
export * from "./injection/memory";
export * from "./injection/company";
export * from "./injection/agent";
export * from "./injection/workflow";
export * from "./injection/schema";
export * from "./injection/examples";
// safety
export * from "./safety/safety";
// validation
export * from "./validation/validation";
// versioning
export * from "./versioning/versioning";
// caching
export * from "./caching/cache";
// observability
export * from "./observability/metrics";