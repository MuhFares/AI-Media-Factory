/**
 * Tool Policies (Req #5).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface ToolPolicy {
  maxConcurrency: number;
  rateLimitRpm?: number;
  perAgentRateLimit?: number;
  requiresApproval: boolean;
  approvers: string[];
  maxCostUsd: number;
  allowedWindows?: TimeWindow[];
  dataResidency?: string[];
}

export interface TimeWindow {
  start: string; // HH:MM UTC
  end: string;   // HH:MM UTC
  timezone: string;
  daysOfWeek: number[]; // 0-6, Sunday=0
}

export interface PolicyEvaluationRequest {
  toolId: string;
  agentId: string;
  workflowId?: string;
  estimatedCostUsd: number;
  currentConcurrency: number;
  agentRateThisMinute: number;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  requiredApprovals: string[];
  overrides: PolicyOverride[];
}

export interface PolicyOverride {
  field: string;
  value: any;
  reason: string;
}

export interface PolicyEngine {
  evaluate(request: PolicyEvaluationRequest): Promise<PolicyDecision>;
  getPolicy(toolId: string): ToolPolicy | null;
  setPolicy(toolId: string, policy: ToolPolicy): void;
}