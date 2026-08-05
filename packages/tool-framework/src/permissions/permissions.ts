/**
 * Tool Permissions (Req #4).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export type Permission =
  | "tool:web_search"
  | "tool:api_call"
  | "tool:file_read"
  | "tool:file_write"
  | "tool:code_exec"
  | "tool:media_generate"
  | "tool:api_call_external"
  | "tool:database_query"
  | "tool:media_process"
  | "tool:data_export"
  | "tool:admin"
  | string;

export interface PermissionPolicy {
  granted: string[];
  denied: string[];
  conditional: ConditionalPermission[];
}

export interface ConditionalPermission {
  permission: string;
  condition: (context: PermissionContext) => boolean;
}

export interface PermissionContext {
  agent: string;
  toolId: string;
  workflowId?: string;
  stepId?: string;
  brandId?: string;
  timeOfDay: string;
}

export interface PermissionPolicy {
  granted: string[];
  denied: string[];
  conditional: ConditionalPermission[];
}

export interface ConditionalPermission {
  permission: string;
  condition: (context: PermissionContext) => boolean;
}

export interface PermissionContext {
  agent: string;
  toolId: string;
  workflowId?: string;
  stepId?: string;
  brandId?: string;
  timeOfDay: string;
}

export interface PermissionEvaluator {
  hasPermission(agent: string, permission: string, context: PermissionContext): boolean;
  getGrantedPermissions(agent: string): string[];
  getDeniedPermissions(agent: string): string[];
}