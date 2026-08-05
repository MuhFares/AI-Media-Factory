/**
 * Tool Registry (Req #1).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, ToolCategory } from "../core/common";
import type { Tool, ToolSpec, ToolHealth } from "../core/tool";

export interface ToolRegistry {
  /** Register a new tool. */
  register(tool: Tool): void;
  
  /** Unregister a tool. */
  unregister(toolId: string): void;
  
  /** Get a tool by ID. */
  get(toolId: string): Tool | null;
  
  /** Get all tools in a category. */
  getByCategory(category: string): Tool[];
  
  /** Get all tools an agent is permitted to use. */
  getByAgent(agentId: string): Tool[];
  
  /** Get all registered tools. */
  all(): Tool[];
  
  /** Validate all registered tools have valid specs. */
  validate(): ValidationReport;
  
  /** Get tool metadata (health, stats). */
  getMetadata(toolId: string): ToolMetadata | null;
}

export interface ValidationReport {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  toolId: string;
  field: string;
  message: string;
}

export interface ValidationWarning {
  toolId: string;
  field: string;
  message: string;
}