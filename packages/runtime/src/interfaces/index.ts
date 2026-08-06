/**
 * Runtime interface contracts.
 *
 * ARCHITECTURE ONLY. These are type/interface declarations that define the
 * shape of the runtime. There are NO implementation bodies anywhere in this
 * package. Concrete implementations satisfy these contracts later.
 *
 * The runtime is generic: none of these contracts mention a specific agent.
 * Every one of the 13 agents is executed through the same interfaces.
 *
 * See ./README.md for how each interface fits the execution pipeline.
 */

export * from "./common.js";
export * from "./runtime.js";
export * from "./loaders.js";
export * from "./context.js";
export * from "./execution.js";
export * from "./validation.js";
export * from "./memory.js";
export * from "./events.js";
export * from "./gates.js";
export * from "./resilience.js";
export * from "./observability.js";
export * from "./errors.js";
