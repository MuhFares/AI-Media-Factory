/**
 * E2E Operating Loop Proof — validation-acceptance payload-bit contract.
 *
 * Machine-readable separation (no DB schema change):
 *
 *   TECHNICAL_VALIDATION_SUCCESS (milestone/overallState)
 *   != VALIDATION_ACCEPTANCE (explicit Owner bit on the exact validation scope)
 *   != PRODUCTION_APPROVAL (distinct target pattern)
 *   != PRODUCTION_AUTHORITY / PUBLICATION_AUTHORITY (grants)
 *   != PUBLICATION_EXECUTION (side effect)
 *
 * The bit lives namespaced inside the existing agent_recommendation JSONB
 * payload (`owner_validation_acceptance: true`) and is recorded only by an
 * explicit Owner decision. Historical rows never carry it and are never
 * backfilled: they read as NOT accepted under this contract.
 */

/** Canonical exact scope carrying validation-acceptance semantics. Exact
 *  equality only — never substring inference. */
export const VALIDATION_ACCEPTANCE_SCOPE = "publication_integration_validation_gate";

/** Namespaced payload key inside agent_recommendation JSONB. Agent-authored
 *  keys never use this prefix, so Owner semantics cannot collide. */
export const VALIDATION_ACCEPTANCE_BIT_KEY = "owner_validation_acceptance";

export interface ValidationAcceptanceRow {
  readonly status: string;
  readonly owner_decision: string | null;
  readonly target_type: string;
  readonly agent_recommendation: unknown;
}

/** True only when the row explicitly carries the Owner-recorded bit. */
export function validationAcceptanceBit(record: unknown): boolean {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  return (record as Record<string, unknown>)[VALIDATION_ACCEPTANCE_BIT_KEY] === true;
}

/**
 * True only for a DECIDED APPROVE on the exact validation-acceptance scope
 * that explicitly carries the Owner-recorded bit. Every other combination —
 * technical milestone success alone, REJECT/MODIFY/REQUEST_ITERATION,
 * production or publication approvals, wrong scope, missing bit, historical
 * rows — reads false. Fail-closed by construction.
 */
export function isValidationAcceptance(row: ValidationAcceptanceRow): boolean {
  return row.status === "DECIDED"
    && row.owner_decision === "APPROVE"
    && row.target_type === VALIDATION_ACCEPTANCE_SCOPE
    && validationAcceptanceBit(row.agent_recommendation);
}
