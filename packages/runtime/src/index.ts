/**
 * @ai-media-factory/runtime — public contract surface.
 *
 * ARCHITECTURE ONLY. Re-exports the interface/type declarations that define
 * the generic agent runtime. No implementation is exported.
 *
 * Provider contracts are NOT re-exported here. They are owned canonically by
 * `@ai-media-factory/providers`; the runtime binds to that layer via
 * ./providers (see src/providers/provider.ts).
 *
 * Prompt Compiler contracts are owned by `@ai-media-factory/prompt-compiler`.
 * The runtime binds to that layer via the PromptCompiler interface.
 *
 * See ./README.md for the architecture, execution flow, and state machine.
 */

export * from "./interfaces/index.js";
export * from "./providers/provider.js";
export * from "./core/agent.js";
export * from "./core/runtime.js";
export * from "./core/executor.js";
