/**
 * @ai-media-factory/agent-registry — public contract surface.
 *
 * ARCHITECTURE ONLY. Re-exports the interface/type declarations that define
 * the Agent Registry. Implementation is exported for use by the runtime.
 */

// core types
export type {
  AgentId,
  Timestamp,
  Version,
  Json,
  AgentState,
  Capability,
  AgentMetadata,
  AgentConfigSchema,
  AgentRegistration,
  AgentFactory,
  AgentInstance,
  ExecutionContext,
  AgentHealth,
  AgentRegistry,
  AgentLoader,
} from "./core/types.js";

// core implementation
export {
  DefaultAgentRegistry,
  getDefaultRegistry,
  setDefaultRegistry,
} from "./core/registry.js";