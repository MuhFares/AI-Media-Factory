import type { Uuid } from "../core/common.js";
import type { PersistencePort } from "./persistence.js";

export const PRODUCTION_POLICY_NAME = "ProductionPolicyV1";
export const PRODUCTION_POLICY_VERSION = "v1";
export type PolicyDecision = "ALLOW" | "DENY" | "HUMAN_GATE_REQUIRED";

export interface PolicyTransitionRequest {
  workflowId: Uuid; correlationId: string | null; sourceStage: string; targetStage: string; ruleId: string;
  requiredEvidence: readonly string[]; artifactIds?: readonly string[]; evidence?: readonly PolicyEvidence[]; policyVersion?: string; humanGate?: boolean; mode?: "new" | "resume";
}
export interface PolicyEvidence { evidenceId: string; workflowId: Uuid; correlationId: string | null; artifactId?: string; artifactHash?: string; lineage?: readonly string[]; kind?: string; valid?: boolean; superseded?: boolean; observedAt?: string; }
export interface DurablePolicyDecision {
  decisionId: string; policyName: typeof PRODUCTION_POLICY_NAME; policyVersion: string; ruleId: string; decision: PolicyDecision;
  reason: string; workflowId: Uuid; correlationId: string | null; sourceStage: string; targetStage: string;
  requiredEvidence: readonly string[]; artifactIds: readonly string[]; evidenceFingerprint?: string; evidenceIds?: readonly string[]; evaluatedAt: string; identity?: string;
}
export interface PolicyEnforcementResult { decision: PolicyDecision; record: DurablePolicyDecision; reused: boolean; }

export function policyDecisionId(r: Pick<PolicyTransitionRequest, "workflowId" | "sourceStage" | "targetStage" | "ruleId">, version: string): string {
  return `policy-${r.workflowId}-${r.sourceStage}-${r.targetStage}-${r.ruleId}-${version}`.replace(/[^A-Za-z0-9_.:-]/g, "_");
}
function stable(value: unknown): string { return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }
function evidenceFingerprint(request: PolicyTransitionRequest): string { return stable((request.evidence ?? []).map((e) => ({ id: e.evidenceId, workflowId: e.workflowId, correlationId: e.correlationId, artifactId: e.artifactId ?? null, hash: e.artifactHash ?? null, lineage: [...(e.lineage ?? [])], valid: e.valid !== false, superseded: e.superseded === true }))); }
function evidenceIsValid(request: PolicyTransitionRequest): boolean {
  if (request.evidence === undefined) return request.requiredEvidence.length > 0;
  if (request.requiredEvidence.length === 0 || request.evidence.length < request.requiredEvidence.length) return false;
  return request.evidence.every((item) => item.workflowId === request.workflowId && item.correlationId === request.correlationId && item.valid !== false && item.superseded !== true && (!item.observedAt || !Number.isNaN(Date.parse(item.observedAt))));
}
function parse(value: unknown): DurablePolicyDecision | null {
  if (value === null || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.policyName !== PRODUCTION_POLICY_NAME || typeof r.decisionId !== "string" || typeof r.policyVersion !== "string" || typeof r.ruleId !== "string" || !["ALLOW", "DENY", "HUMAN_GATE_REQUIRED"].includes(String(r.decision)) || typeof r.workflowId !== "string" || typeof r.targetStage !== "string") return null;
  return r as unknown as DurablePolicyDecision;
}

/** Single durable transition boundary. All production callers should use this class. */
export class ProductionPolicyEnforcer {
  constructor(private readonly persistence: PersistencePort) {}
  async evaluate(request: PolicyTransitionRequest): Promise<PolicyEnforcementResult> {
    const version = request.policyVersion ?? PRODUCTION_POLICY_VERSION;
    const decisionId = policyDecisionId(request, version);
    const currentEvidenceFingerprint = evidenceFingerprint(request);
    const existing = (await this.persistence.listDecisions(request.workflowId)).find((a) => a.decisionId === decisionId && a.kind === "production_policy");
    const prior = existing ? parse(existing.payload) : null;
    if (prior !== null) {
      const valid = prior.workflowId === request.workflowId && prior.correlationId === request.correlationId && prior.policyVersion === version && prior.ruleId === request.ruleId && prior.sourceStage === request.sourceStage && prior.targetStage === request.targetStage && JSON.stringify(prior.artifactIds) === JSON.stringify([...(request.artifactIds ?? [])]) && (prior.evidenceFingerprint === undefined || prior.evidenceFingerprint === currentEvidenceFingerprint);
      if (valid) return { decision: prior.decision, record: prior, reused: true };
      return { decision: "DENY", record: { ...prior, decision: "DENY", reason: "STALE_OR_MISMATCHED_POLICY_DECISION" }, reused: false };
    }
    if (request.mode === "resume") throw Object.assign(new Error("MISSING_POLICY_DECISION"), { code: "MISSING_POLICY_DECISION" });
    const decision: PolicyDecision = request.humanGate ? "HUMAN_GATE_REQUIRED" : evidenceIsValid(request) ? "ALLOW" : "DENY";
    const evaluatedAt = new Date().toISOString();
    const record: DurablePolicyDecision = { decisionId, policyName: PRODUCTION_POLICY_NAME, policyVersion: version, ruleId: request.ruleId, decision, reason: request.humanGate ? "Human approval is required before this governed transition." : decision === "DENY" ? "Required evidence is missing, invalid, stale, superseded, or mismatched." : "Required policy evidence is present for this transition.", workflowId: request.workflowId, correlationId: request.correlationId, sourceStage: request.sourceStage, targetStage: request.targetStage, requiredEvidence: [...request.requiredEvidence], artifactIds: [...(request.artifactIds ?? [])], evidenceFingerprint: currentEvidenceFingerprint, evidenceIds: [...(request.evidence ?? []).map((e) => e.evidenceId)], evaluatedAt, identity: `policy-decision:${decisionId}` };
    await this.persistence.saveDecision({ decisionId, kind: "production_policy", workflowId: request.workflowId, correlationId: request.correlationId, cycle: null, payload: record as never, createdAt: evaluatedAt });
    return { decision, record, reused: false };
  }
  async assertAllowed(request: PolicyTransitionRequest): Promise<PolicyEnforcementResult> {
    const result = await this.evaluate(request);
    if (result.decision !== "ALLOW") throw new Error(`POLICY_${result.decision}:${result.record.reason}`);
    return result;
  }
}
