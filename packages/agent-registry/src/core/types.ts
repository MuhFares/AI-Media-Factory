/**
 * Shared primitives for the agent registry.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

export type AgentId = string;
export type Timestamp = string; // ISO-8601 UTC
export type Version = string;   // semver

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** Agent lifecycle states. */
export type AgentState =
  | "UNREGISTERED"
  | "REGISTERED"
  | "INITIALIZING"
  | "READY"
  | "BUSY"
  | "ERROR"
  | "DISPOSING"
  | "DISPOSED";

/** Agent capability identifiers. */
export type Capability =
  | "text-generation"
  | "image-generation"
  | "audio-generation"
  | "video-generation"
  | "text-embedding"
  | "image-embedding"
  | "code-execution"
  | "web-search"
  | "file-operations"
  | "api-call"
  | "data-processing"
  | "workflow-orchestration"
  | string;

/** Agent metadata. */
export interface AgentMetadata {
  id: AgentId;
  name: string;
  version: Version;
  description: string;
  capabilities: Capability[];
  tags: string[];
  author?: string;
  homepage?: string;
  license?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Agent configuration schema. */
export interface AgentConfigSchema {
  type: "object";
  properties: Record<string, Json>;
  required?: string[];
}

/** Agent registration entry. */
export interface AgentRegistration {
  metadata: AgentMetadata;
  configSchema: AgentConfigSchema;
  defaultConfig: Json;
  factory: AgentFactory;
  state: AgentState;
  error?: string;
  initializedAt?: Timestamp;
  disposedAt?: Timestamp;
}

/** Agent factory function signature. */
export type AgentFactory = (config: Json) => Promise<AgentInstance>;

/** Agent instance interface. */
export interface AgentInstance {
  readonly id: AgentId;
  readonly metadata: AgentMetadata;
  readonly config: Json;
  initialize(): Promise<void>;
  execute(input: Json, context: ExecutionContext): Promise<Json>;
  health(): Promise<AgentHealth>;
  dispose(): Promise<void>;
}

/** Execution context for agent runs. */
export interface ExecutionContext {
  workflowId?: string;
  stepId?: string;
  correlationId?: string;
  traceId?: string;
  deadline?: Timestamp;
  metadata?: Record<string, Json>;
}

/** Agent health status. */
export interface AgentHealth {
  healthy: boolean;
  details?: string;
  lastCheck: Timestamp;
}

/** Agent registry interface. */
export interface AgentRegistry {
  /** Register a new agent. */
  register(registration: AgentRegistration): Promise<void>;

  /** Unregister an agent. */
  unregister(agentId: AgentId): Promise<void>;

  /** Resolve and create an agent instance. */
  resolve(agentId: AgentId, config?: Json): Promise<AgentInstance>;

  /** Discover agents by capability. */
  discover(capability: Capability): Promise<AgentMetadata[]>;

  /** List all registered agents. */
  list(): Promise<AgentMetadata[]>;

  /** Get agent metadata by ID. */
  getMetadata(agentId: AgentId): Promise<AgentMetadata | null>;

  /** Get agent state. */
  getState(agentId: AgentId): Promise<AgentState | null>;

  /** Check if agent is registered. */
  has(agentId: AgentId): boolean;

  /** Initialize an agent (lazy loading). */
  initialize(agentId: AgentId, config?: Json): Promise<AgentInstance>;

  /** Dispose an agent instance. */
  dispose(agentId: AgentId): Promise<void>;

  /** Dispose all agents. */
  disposeAll(): Promise<void>;
}

/** Agent loader interface for plugin support. */
export interface AgentLoader {
  /** Load agents from a source. */
  load(): Promise<AgentRegistration[]>;

  /** Watch for changes (hot reload). */
  watch?(callback: (registrations: AgentRegistration[]) => void): void;
}