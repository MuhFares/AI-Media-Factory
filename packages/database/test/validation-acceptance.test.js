/**
 * E2E Operating Loop Proof M0 — validation-acceptance payload-bit matrix.
 * Pure unit tests (no DB, no providers). Machine-readable separation:
 * technical milestone success != validation acceptance != production or
 * publication approval/authority. Historical rows never carry the bit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VALIDATION_ACCEPTANCE_SCOPE,
  VALIDATION_ACCEPTANCE_BIT_KEY,
  validationAcceptanceBit,
  isValidationAcceptance,
} from "../dist/index.js";

const BIT = { [VALIDATION_ACCEPTANCE_BIT_KEY]: true };
const row = (over = {}) => ({
  status: "DECIDED",
  owner_decision: "APPROVE",
  target_type: VALIDATION_ACCEPTANCE_SCOPE,
  agent_recommendation: { ...BIT },
  ...over,
});

test("1: technical validation success alone never accepts", () => {
  assert.equal(isValidationAcceptance(row({ status: "PENDING", owner_decision: null, agent_recommendation: {} })), false);
  assert.equal(isValidationAcceptance(row({ status: "AWAITING_OWNER", owner_decision: null, agent_recommendation: {} })), false);
  // Historical shape: DECIDED APPROVE on the exact scope but no explicit bit.
  assert.equal(isValidationAcceptance(row({ agent_recommendation: { engine: "COMFY_FLUX" } })), false);
  assert.equal(isValidationAcceptance(row({ agent_recommendation: null })), false);
});

test("2: APPROVE on exact scope with explicit bit accepts", () => {
  assert.equal(isValidationAcceptance(row()), true);
});

test("3: REJECT / MODIFY / REQUEST_ITERATION never accept, even with bit present", () => {
  for (const d of ["REJECT", "MODIFY", "REQUEST_ITERATION", "OVERRIDE"]) {
    assert.equal(isValidationAcceptance(row({ owner_decision: d })), false, d);
  }
});

test("4: production approval never masquerades as validation acceptance", () => {
  assert.equal(isValidationAcceptance(row({
    target_type: "workflow_gate",
    agent_recommendation: { target: "wf-1:production-approved", ...BIT },
  })), false);
  // Even a bit-carrying production row fails on exact-scope mismatch.
  assert.equal(isValidationAcceptance(row({
    target_type: "production_approval",
    agent_recommendation: { ...BIT },
  })), false);
});

test("5: publication approval never implies validation acceptance", () => {
  assert.equal(isValidationAcceptance(row({
    target_type: "publisher_authorization",
    agent_recommendation: { target: "wf-1:public_publish", ...BIT },
  })), false);
  assert.equal(isValidationAcceptance(row({
    target_type: "publication_integration_validation_gate_extra",
    agent_recommendation: { ...BIT },
  })), false);
});

test("8: scope matching is exact and fail-closed", () => {
  // Near-miss scope without the _gate suffix.
  assert.equal(isValidationAcceptance(row({ target_type: "publication_integration_validation", agent_recommendation: { ...BIT } })), false);
  // Case variant is not the canonical scope.
  assert.equal(isValidationAcceptance(row({ target_type: "PUBLICATION_INTEGRATION_VALIDATION_GATE", agent_recommendation: { ...BIT } })), false);
  // Bit must be boolean true, not truthy text.
  assert.equal(isValidationAcceptance(row({ agent_recommendation: { [VALIDATION_ACCEPTANCE_BIT_KEY]: "true" } })), false);
  assert.equal(isValidationAcceptance(row({ agent_recommendation: { [VALIDATION_ACCEPTANCE_BIT_KEY]: 1 } })), false);
  // Malformed payloads fail closed.
  assert.equal(isValidationAcceptance(row({ agent_recommendation: "not-json" })), false);
  assert.equal(isValidationAcceptance(row({ agent_recommendation: [true] })), false);
  // Scope constant is the canonical exact value.
  assert.equal(VALIDATION_ACCEPTANCE_SCOPE, "publication_integration_validation_gate");
});

test("bit reader is namespaced and collision-safe", () => {
  assert.equal(validationAcceptanceBit({ [VALIDATION_ACCEPTANCE_BIT_KEY]: true }), true);
  assert.equal(validationAcceptanceBit({ ok: true, engine: "x" }), false);
  assert.equal(validationAcceptanceBit(null), false);
  assert.equal(validationAcceptanceBit(undefined), false);
});
