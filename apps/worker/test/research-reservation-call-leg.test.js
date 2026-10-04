/** Provider-free unit tests for research reservation call-leg mapping. No DB, no network. */
import test from "node:test";
import assert from "node:assert/strict";
import { researchReservationCallLeg } from "../dist/index.js";

test("research retrieval legs map to RETRIEVAL", () => {
  assert.equal(researchReservationCallLeg("research", "research", ":retrieval:1"), "RETRIEVAL");
  assert.equal(researchReservationCallLeg("research", "research", ":retrieval:4"), "RETRIEVAL");
});

test("research synthesis leg maps to FINAL_SYNTHESIS", () => {
  assert.equal(researchReservationCallLeg("research", "text_agent", ":synthesis"), "FINAL_SYNTHESIS");
});

test("research planning text leg maps to DIRECTION", () => {
  assert.equal(researchReservationCallLeg("research", "text_agent", ""), "DIRECTION");
});

test("non-research agents carry no canonical leg", () => {
  for (const agent of ["orchestrator", "ceo", "planner", "writer", "director", "visual-director", "review", "qa"]) {
    assert.equal(researchReservationCallLeg(agent, "text_agent", ""), null, agent);
  }
});
