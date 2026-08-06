/**
 * Default AgentRegistry implementation.
 */

import type {
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
} from "./types.js";

/** Internal agent entry with lifecycle tracking. */
interface AgentEntry {
  registration: AgentRegistration;
  instance: AgentInstance | null;
  config: Json;
  initializedAt?: Timestamp;
  disposedAt?: Timestamp;
  disposePromise?: Promise<void>;
}

export class DefaultAgentRegistry implements AgentRegistry {
  private agents = new Map<AgentId, AgentEntry>();
  private loaders = new Map<string, AgentLoader>();
  private initializationLocks = new Map<AgentId, Promise<AgentInstance>>();

  constructor() {}

  async register(registration: AgentRegistration): Promise<void> {
    const { metadata } = registration;
    const agentId = metadata.id;

    if (this.agents.has(agentId)) {
      throw new Error(`Agent already registered: ${agentId}`);
    }

    // Validate metadata
    this.validateMetadata(metadata);

    // Set timestamps
    const now = new Date().toISOString();
    const updatedRegistration: AgentRegistration = {
      ...registration,
      metadata: {
        ...metadata,
        createdAt: metadata.createdAt ?? now,
        updatedAt: now,
      },
      state: "REGISTERED",
    };

    this.agents.set(agentId, {
      registration: updatedRegistration,
      instance: null,
      config: registration.defaultConfig,
    });
  }

  async unregister(agentId: AgentId): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Dispose if initialized
    if (entry.instance) {
      await this.disposeInstance(entry);
    }

    this.agents.delete(agentId);
    this.initializationLocks.delete(agentId);
  }

  async resolve(agentId: AgentId, config?: Json): Promise<AgentInstance> {
    // Check if already initializing
    const existingLock = this.initializationLocks.get(agentId);
    if (existingLock) {
      return existingLock;
    }

    // Create initialization promise
    const initPromise = this.initializeInstance(agentId, config);
    this.initializationLocks.set(agentId, initPromise);

    try {
      return await initPromise;
    } finally {
      this.initializationLocks.delete(agentId);
    }
  }

  async discover(capability: Capability): Promise<AgentMetadata[]> {
    const results: AgentMetadata[] = [];
    for (const entry of this.agents.values()) {
      if (entry.registration.metadata.capabilities.includes(capability)) {
        results.push(entry.registration.metadata);
      }
    }
    return results;
  }

  async list(): Promise<AgentMetadata[]> {
    const results: AgentMetadata[] = [];
    for (const entry of this.agents.values()) {
      results.push(entry.registration.metadata);
    }
    return results;
  }

  async getMetadata(agentId: AgentId): Promise<AgentMetadata | null> {
    const entry = this.agents.get(agentId);
    return entry ? entry.registration.metadata : null;
  }

  async getState(agentId: AgentId): Promise<AgentState | null> {
    const entry = this.agents.get(agentId);
    return entry ? entry.registration.state : null;
  }

  has(agentId: AgentId): boolean {
    return this.agents.has(agentId);
  }

  async initialize(agentId: AgentId, config?: Json): Promise<AgentInstance> {
    return this.initializeInstance(agentId, config);
  }

  async dispose(agentId: AgentId): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (entry.instance) {
      await this.disposeInstance(entry);
    }
  }

  async disposeAll(): Promise<void> {
    const agentIds = Array.from(this.agents.keys());
    await Promise.all(agentIds.map((id) => this.dispose(id)));
  }

  /** Register an agent loader for plugin support. */
  registerLoader(name: string, loader: AgentLoader): void {
    this.loaders.set(name, loader);
  }

  /** Load agents from all registered loaders. */
  async loadAll(): Promise<void> {
    for (const loader of this.loaders.values()) {
      const registrations = await loader.load();
      for (const registration of registrations) {
        if (!this.agents.has(registration.metadata.id)) {
          await this.register(registration);
        }
      }
    }
  }

  private async initializeInstance(agentId: AgentId, config?: Json): Promise<AgentInstance> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // Return existing instance if already initialized with same config
    if (entry.instance && this.configEquals(entry.config, config ?? entry.registration.defaultConfig)) {
      return entry.instance;
    }

    // Dispose old instance if exists
    if (entry.instance) {
      await this.disposeInstance(entry);
    }

    // Update state to INITIALIZING
    entry.registration.state = "INITIALIZING";
    entry.registration.error = undefined;

    try {
      // Merge config with defaults
      const mergedConfig = this.mergeConfig(entry.registration.defaultConfig, config ?? {});

      // Include metadata in config for factory
      const factoryConfig = {
        ...(mergedConfig && typeof mergedConfig === "object" ? mergedConfig as Record<string, Json> : {}),
        metadata: entry.registration.metadata,
        id: entry.registration.metadata.id,
      };

      // Create instance via factory
      const instance = await entry.registration.factory(factoryConfig as unknown as Json);

      // Initialize the instance
      await instance.initialize();

      // Update entry
      entry.instance = instance;
      entry.config = mergedConfig;
      entry.initializedAt = new Date().toISOString();
      entry.registration.state = "READY";

      return instance;
    } catch (error) {
      entry.registration.state = "ERROR";
      entry.registration.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async disposeInstance(entry: AgentEntry): Promise<void> {
    if (!entry.instance) return;

    entry.registration.state = "DISPOSING";

    try {
      await entry.instance.dispose();
    } catch (error) {
      // Log error but continue disposal
      console.error(`Error disposing agent ${entry.registration.metadata.id}:`, error);
    } finally {
      entry.instance = null;
      entry.registration.state = "DISPOSED";
      entry.disposedAt = new Date().toISOString();
    }
  }

  private validateMetadata(metadata: AgentMetadata): void {
    if (!metadata.id) throw new Error("Agent ID is required");
    if (!metadata.name) throw new Error("Agent name is required");
    if (!metadata.version) throw new Error("Agent version is required");
    if (!metadata.description) throw new Error("Agent description is required");
    if (!Array.isArray(metadata.capabilities)) throw new Error("Capabilities must be an array");
    if (!Array.isArray(metadata.tags)) throw new Error("Tags must be an array");
  }

  private mergeConfig(defaultConfig: Json, userConfig: Json): Json {
    if (typeof defaultConfig !== "object" || defaultConfig === null) return userConfig;
    if (typeof userConfig !== "object" || userConfig === null) return defaultConfig;

    const result: Record<string, Json> = { ...(defaultConfig as Record<string, Json>) };
    for (const [key, value] of Object.entries(userConfig as Record<string, Json>)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        result[key] = this.mergeConfig(result[key] ?? {}, value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private configEquals(a: Json, b: Json): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

/** Singleton instance for convenience. */
let defaultRegistry: DefaultAgentRegistry | null = null;

export function getDefaultRegistry(): DefaultAgentRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new DefaultAgentRegistry();
  }
  return defaultRegistry;
}

export function setDefaultRegistry(registry: DefaultAgentRegistry): void {
  defaultRegistry = registry;
}