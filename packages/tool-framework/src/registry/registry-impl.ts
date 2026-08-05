import type { ToolRegistry, ToolMetadata, ValidationReport, ValidationError, ValidationWarning } from "../registry/registry.js";
import type { Tool, ToolSpec } from "../core/tool.js";
import type { ToolCategory } from "../categories/categories.js";
import { DEFAULT_CATEGORY_CONFIGS } from "../categories/categories.js";

export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool>();
  private metadata = new Map<string, ToolMetadata>();
  private categoryIndex = new Map<string, Set<string>>();
  private agentPermissions = new Map<string, Set<string>>();

  register(tool: Tool): void {
    const toolId = tool.spec.id;
    this.tools.set(toolId, tool);
    this.metadata.set(toolId, {
      spec: tool.spec,
      registeredAt: new Date().toISOString(),
      registeredBy: "system",
      healthStatus: "healthy",
      lastHealthCheck: new Date().toISOString(),
      invocationCount: 0,
      successRate: 1.0,
      avgLatencyMs: 0,
    });

    const category = tool.spec.category;
    if (!this.categoryIndex.has(category)) {
      this.categoryIndex.set(category, new Set());
    }
    this.categoryIndex.get(category)!.add(toolId);
  }

  unregister(toolId: string): void {
    const tool = this.tools.get(toolId);
    if (tool) {
      const category = tool.spec.category;
      this.categoryIndex.get(category)?.delete(toolId);
    }
    this.tools.delete(toolId);
    this.metadata.delete(toolId);
  }

  get(toolId: string): Tool | null {
    return this.tools.get(toolId) ?? null;
  }

  getByCategory(category: string): Tool[] {
    const toolIds = this.categoryIndex.get(category) ?? new Set();
    return Array.from(toolIds).map((id) => this.tools.get(id)!).filter(Boolean);
  }

  getByAgent(agentId: string): Tool[] {
    const permittedIds = this.agentPermissions.get(agentId);
    if (!permittedIds) {
      return this.all();
    }
    return Array.from(permittedIds).map((id) => this.tools.get(id)!).filter(Boolean);
  }

  all(): Tool[] {
    return Array.from(this.tools.values());
  }

  validate(): ValidationReport {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const [toolId, tool] of this.tools) {
      const spec = tool.spec;

      if (!spec.id) {
        errors.push({ toolId, field: "id", message: "Tool ID is required" });
      }
      if (!spec.name) {
        errors.push({ toolId, field: "name", message: "Tool name is required" });
      }
      if (!spec.category) {
        errors.push({ toolId, field: "category", message: "Tool category is required" });
      }
      if (!spec.inputSchema) {
        errors.push({ toolId, field: "inputSchema", message: "Input schema is required" });
      }
      if (!spec.outputSchema) {
        errors.push({ toolId, field: "outputSchema", message: "Output schema is required" });
      }
      if (typeof spec.timeoutMs !== "number" || spec.timeoutMs <= 0) {
        errors.push({ toolId, field: "timeoutMs", message: "Timeout must be a positive number" });
      }
      if (typeof spec.estimatedCostUsd !== "number" || spec.estimatedCostUsd < 0) {
        warnings.push({ toolId, field: "estimatedCostUsd", message: "Estimated cost should be a non-negative number" });
      }

      const categoryConfig = DEFAULT_CATEGORY_CONFIGS[spec.category];
      if (!categoryConfig) {
        warnings.push({ toolId, field: "category", message: `Unknown category: ${spec.category}` });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  getMetadata(toolId: string): ToolMetadata | null {
    return this.metadata.get(toolId) ?? null;
  }

  setAgentPermissions(agentId: string, permissions: string[]): void {
    this.agentPermissions.set(agentId, new Set(permissions));
  }

  getCategories(): string[] {
    return Array.from(this.categoryIndex.keys());
  }

  updateMetadata(toolId: string, updates: Partial<ToolMetadata>): void {
    const existing = this.metadata.get(toolId);
    if (existing) {
      this.metadata.set(toolId, { ...existing, ...updates });
    }
  }
}