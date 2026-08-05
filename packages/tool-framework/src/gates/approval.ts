/**
 * Approval Gates (Req #15).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface ApprovalGate {
  isApprovalRequired(toolId: string, context: ApprovalContext): boolean;
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
  applyDecision(decision: ApprovalDecision): Promise<void>;
}

export interface ApprovalRequest {
  invocationId: string;
  toolId: string;
  agent: string;
  workflowId?: string;
  input: any;
  reason: string;
  urgency: "low" | "normal" | "high" | "critical";
  expiresAt: string;
}

export interface ApprovalDecision {
  invocationId: string;
  approved: boolean;
  approver: string;
  reason: string;
  conditions?: string[];
  decidedAt: string;
}

export interface ApprovalContext {
  toolId: string;
  agent: string;
  workflowId?: string;
  input: any;
  estimatedCostUsd: number;
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface ApprovalRule {
  toolId: string;
  condition: (context: ApprovalContext) => boolean;
  requiredApprovers: string[];
  autoApproveThresholdUsd?: number;
}

export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  { toolId: "file_write", condition: () => true, requiredApprovers: ["human_operator"] },
  { toolId: "code_exec", condition: () => true, requiredApprovers: ["human_operator"] },
  { toolId: "media_generate", condition: (ctx) => ctx.estimatedCostUsd > 0.10, requiredApprovers: ["human_operator"] },
  { toolId: "database_query", condition: (ctx) => ctx.riskLevel === "high", requiredApprovers: ["dba"] },
];