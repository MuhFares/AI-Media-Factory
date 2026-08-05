/**
 * Memory Factory — creates and manages memory instances.
 */

import {
  BaseMemory,
  ConversationMemory,
  SessionMemory,
  WorkspaceMemory,
  NamespaceConfig,
  MemoryFactory,
} from "./memory-layer.js";

import {
  InMemoryMemory,
  InMemoryConversationMemory,
  InMemorySessionMemory,
  InMemoryWorkspaceMemory,
} from "./inmemory.js";

/** Default factory configuration. */
interface FactoryConfig {
  defaultTTLDays?: number;
  defaultMaxRecords?: number;
}

/** Default MemoryFactory implementation. */
export class DefaultMemoryFactory implements MemoryFactory {
  private instances = new Map<string, BaseMemory>();
  private customFactories = new Map<string, () => BaseMemory>();
  private readonly config: FactoryConfig;

  constructor(config: FactoryConfig = {}) {
    this.config = {
      defaultTTLDays: config.defaultTTLDays ?? 30,
      defaultMaxRecords: config.defaultMaxRecords ?? 10000,
    };
  }

  createConversation(namespace: string, config?: Partial<NamespaceConfig>): ConversationMemory {
    const fullConfig: NamespaceConfig = {
      type: "session",
      ttlDays: config?.ttlDays ?? this.config.defaultTTLDays,
      maxRecords: config?.maxRecords ?? this.config.defaultMaxRecords,
      enableCompression: config?.enableCompression ?? false,
      ...config,
    };
    const memory = new InMemoryConversationMemory(namespace, fullConfig);
    this.instances.set(namespace, memory);
    return memory;
  }

  createSession(namespace: string, config?: Partial<NamespaceConfig>): SessionMemory {
    const fullConfig: NamespaceConfig = {
      type: "workflow",
      ttlDays: config?.ttlDays ?? this.config.defaultTTLDays,
      maxRecords: config?.maxRecords ?? this.config.defaultMaxRecords,
      enableCompression: config?.enableCompression ?? false,
      ...config,
    };
    const memory = new InMemorySessionMemory(namespace, fullConfig);
    this.instances.set(namespace, memory);
    return memory;
  }

  createWorkspace(namespace: string, config?: Partial<NamespaceConfig>): WorkspaceMemory {
    const fullConfig: NamespaceConfig = {
      type: "knowledge",
      ttlDays: config?.ttlDays,
      maxRecords: config?.maxRecords ?? this.config.defaultMaxRecords,
      enableCompression: config?.enableCompression ?? true,
      ...config,
    };
    const memory = new InMemoryWorkspaceMemory(namespace, fullConfig);
    this.instances.set(namespace, memory);
    return memory;
  }

  create(namespace: string, config: NamespaceConfig): BaseMemory {
    const fullConfig: NamespaceConfig = {
      ttlDays: config.ttlDays ?? this.config.defaultTTLDays,
      maxRecords: config.maxRecords ?? this.config.defaultMaxRecords,
      enableCompression: config.enableCompression ?? false,
      ...config,
    };

    // Check for custom factory
    const customFactory = this.customFactories.get(config.type);
    if (customFactory) {
      const memory = customFactory();
      this.instances.set(namespace, memory);
      return memory;
    }

    // Default to InMemoryMemory
    const memory = new InMemoryMemory(namespace, fullConfig);
    this.instances.set(namespace, memory);
    return memory;
  }

  get(namespace: string): BaseMemory | undefined {
    return this.instances.get(namespace);
  }

  register(type: string, factory: () => BaseMemory): void {
    this.customFactories.set(type, factory);
  }

  listTypes(): string[] {
    return ["conversation", "session", "workspace", ...Array.from(this.customFactories.keys())];
  }

  async shutdown(): Promise<void> {
    for (const memory of this.instances.values()) {
      // In a real implementation, we'd call a shutdown method
      // For now, just clear the instances
    }
    this.instances.clear();
  }
}

/** Singleton instance for convenience. */
let defaultFactory: DefaultMemoryFactory | null = null;

export function getDefaultFactory(config?: FactoryConfig): DefaultMemoryFactory {
  if (!defaultFactory) {
    defaultFactory = new DefaultMemoryFactory(config);
  }
  return defaultFactory;
}

export function setDefaultFactory(factory: DefaultMemoryFactory): void {
  defaultFactory = factory;
}