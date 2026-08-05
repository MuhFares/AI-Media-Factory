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

export * from "./runtime";
export * from "./loaders";
export * from "./context";
export * from "./execution";
export * from "./validation";
export * from "./memory";
export * from "./events";
export * from "./gates";
export * from "./resilience";
export * from "./observability";
export * from "./errors";
