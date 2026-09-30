import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { directiveToWorkflowDefinition, withPreProductionOwnerGate, PRE_PRODUCTION_OWNER_GATE_STEP_ID } from "../dist/index.js";

describe("production pre-Wan visual gate", () => {
  it("places a durable human gate between thumbnail and video", () => {
    const definition = directiveToWorkflowDefinition("produce");
    const visualQa = definition.steps.find((step) => step.id === "visual-technical-qa");
    const gate = definition.steps.find((step) => step.id === "visual-human-gate");
    const video = definition.steps.find((step) => step.id === "video");
    strictEqual(visualQa?.kind, "agent");
    strictEqual(visualQa?.next, "visual-human-gate");
    strictEqual(gate?.kind, "gate");
    strictEqual(gate?.next, "wan-authorization");
    strictEqual(video?.kind, "agent");
    deepStrictEqual(definition.steps.filter((step) => step.id === "visual-human-gate").map((step) => step.id), ["visual-human-gate"]);
    const directorIndex = definition.steps.findIndex((step) => step.id === "director");
    deepStrictEqual(definition.steps.slice(directorIndex, directorIndex + 9).map((step) => step.id), ["director", "visual-direction", "tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa", "visual-human-gate", "wan-authorization"]);
  });
});

describe("pre-production owner gate", () => {
  it("places a durable owner gate between review and director", () => {
    const definition = directiveToWorkflowDefinition("produce");
    const review = definition.steps.find((step) => step.id === "review");
    const gate = definition.steps.find((step) => step.id === PRE_PRODUCTION_OWNER_GATE_STEP_ID);
    const director = definition.steps.find((step) => step.id === "director");
    strictEqual(review?.kind, "agent");
    strictEqual(review?.next, PRE_PRODUCTION_OWNER_GATE_STEP_ID);
    strictEqual(gate?.kind, "gate");
    strictEqual(gate?.approver, "human_operator");
    strictEqual(gate?.next, "director");
    strictEqual(director?.kind, "agent");
    deepStrictEqual(definition.steps.filter((step) => step.id === PRE_PRODUCTION_OWNER_GATE_STEP_ID).map((step) => step.id), [PRE_PRODUCTION_OWNER_GATE_STEP_ID]);
    const reviewIndex = definition.steps.findIndex((step) => step.id === "review");
    deepStrictEqual(definition.steps.slice(reviewIndex, reviewIndex + 4).map((step) => step.id), ["review", PRE_PRODUCTION_OWNER_GATE_STEP_ID, "director", "visual-direction"]);
  });

  it("upgrades a legacy persisted definition idempotently and leaves other directives unchanged", () => {
    const legacy = directiveToWorkflowDefinition("produce");
    const withoutGate = { ...legacy, steps: legacy.steps.filter((step) => step.id !== PRE_PRODUCTION_OWNER_GATE_STEP_ID).map((step) => step.id === "review" ? { ...step, next: "director" } : step) };
    const upgraded = withPreProductionOwnerGate(withoutGate);
    strictEqual(upgraded.steps.find((step) => step.id === "review")?.next, PRE_PRODUCTION_OWNER_GATE_STEP_ID);
    strictEqual(upgraded.steps.find((step) => step.id === PRE_PRODUCTION_OWNER_GATE_STEP_ID)?.next, "director");
    strictEqual(withPreProductionOwnerGate(upgraded), upgraded, "already upgraded definitions are unchanged");
    const unrelated = { ...legacy, steps: legacy.steps.filter((step) => step.id !== "review" && step.id !== PRE_PRODUCTION_OWNER_GATE_STEP_ID) };
    strictEqual(withPreProductionOwnerGate(unrelated), unrelated, "definitions without review are untouched");
    // A review that already flows into a human gate keeps its existing owner stop.
    const alreadyGated = { ...withoutGate, steps: withoutGate.steps.map((step) => step.id === "review" ? { ...step, next: "visual-human-gate" } : step).concat([{ id: "visual-human-gate", kind: "gate", approver: "human_operator", reason: "existing owner stop" }]) };
    strictEqual(withPreProductionOwnerGate(alreadyGated), alreadyGated, "no second consecutive gate is inserted");
  });
});
