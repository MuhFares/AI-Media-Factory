/**
 * Recovery frontier regression — the 2026-09-14 analytics incident.
 *
 * A cold engine.resume() of an instance persisted at AWAITING_APPROVAL (a
 * human gate running) once emptied the recovered ready frontier and triggered
 * the recovery safety net, which selected the "first pending step" from the
 * STORED step-array order. The Postgres adapter loads step rows
 * alphabetically (`ORDER BY step_id`), so the spurious alphabetically-first
 * downstream stage (`analytics` in the produce chain) was injected into the
 * frontier and executed in parallel with the gate's true successor — failing
 * the workflow on a stage that must never have run.
 *
 * This fixture reproduces the exact shape: a persistence stub whose
 * loadWorkflow returns step records alphabetically (like the adapter), a
 * workflow stopped at a running gate, and a cold resume + approval. The
 * recovered frontier must continue from the gate's successor only.
 */

import { test } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import {
  DefaultWorkflowStateMachine,
  DefaultTimeoutController,
  DefaultWorkflowRetryPolicy,
  DefaultScheduler,
  DefaultBranchRouter,
  DefaultCheckpointCoordinator,
  DefaultRecoveryManager,
  DefaultCompensationRunner,
  DefaultApprovalCoordinator,
  DefaultStepExecutor,
  DefaultDeadLetterSink,
  DefaultAuditTrail,
  DefaultWorkflowLogger,
  DefaultWorkflowMetrics,
  DefaultWorkflowEventBridge,
  DefaultWorkflowEngine,
  workflow,
} from "@ai-media-factory/workflow-engine";

const clone = (value) => JSON.parse(JSON.stringify(value));

/**
 * Minimal persistence whose loadWorkflow returns step records ALPHABETICALLY
 * — mirroring the Postgres adapter's `ORDER BY step_id`.
 */
class AlphabeticalPersistence {
  workflows = new Map();
  checkpoints = new Map();
  artifacts = new Map();
  decisions = new Map();
  async saveWorkflow(v) { this.workflows.set(v.workflowId, clone(v)); }
  async loadWorkflow(id) {
    const value = this.workflows.get(id);
    if (!value) return null;
    const loaded = clone(value);
    // The incident condition: the adapter's row order is alphabetical.
    loaded.steps = [...loaded.steps].sort((a, b) => a.stepId.localeCompare(b.stepId));
    return loaded;
  }
  async saveCheckpoint(v) { this.checkpoints.set(v.workflowId, clone(v)); }
  async loadLatestCheckpoint(id) { const v = this.checkpoints.get(id); return v ? clone(v) : null; }
  async saveArtifact(v) { this.artifacts.set(v.artifactId, clone(v)); }
  async listArtifacts(id) { return [...this.artifacts.values()].filter((a) => a.workflowId === id).map(clone); }
  async saveDecision(v) { this.decisions.set(v.decisionId, clone(v)); }
  async listDecisions(id) { return [...this.decisions.values()].filter((d) => d.workflowId === id).map(clone); }
}

function buildEngine(persistence, definition) {
  const stateMachine = new DefaultWorkflowStateMachine();
  const scheduler = new DefaultScheduler();
  const checkpointCoordinator = new DefaultCheckpointCoordinator(persistence);
  const recoveryManager = new DefaultRecoveryManager(
    checkpointCoordinator,
    persistence,
    async () => definition,
  );
  const stepExecutor = new DefaultStepExecutor(
    { executeAgentStep: async (step) => ({ status: "completed", output: { stepId: step.id } }) },
    new DefaultBranchRouter(),
    scheduler,
    new DefaultTimeoutController(),
    new DefaultWorkflowRetryPolicy(),
    checkpointCoordinator,
    async (id) => persistence.loadWorkflow(id),
    stateMachine,
  );
  return new DefaultWorkflowEngine(
    stepExecutor,
    scheduler,
    stateMachine,
    checkpointCoordinator,
    recoveryManager,
    new DefaultCompensationRunner(() => null, async () => {}),
    new DefaultApprovalCoordinator(async () => {}),
    new DefaultDeadLetterSink(new DefaultWorkflowEventBridge(async () => {})),
    new DefaultAuditTrail(),
    new DefaultWorkflowLogger(),
    new DefaultWorkflowMetrics(),
    new DefaultWorkflowEventBridge(async () => {}),
    persistence,
    async () => definition,
  );
}

// Definition shaped like the production incident: gate -> b (true successor),
// with `analytics` an unrelated LATE stage that sorts FIRST alphabetically.
const definition = workflow().id("incident").version(1).trigger("manual", "test").entryStep("alpha")
  .addAgentStep({ id: "alpha", agent: "alpha", emits: "alpha", next: "gate" })
  .addGateStep({ id: "gate", approver: "human_operator", reason: "test gate", next: "b" })
  .addAgentStep({ id: "b", agent: "b", emits: "b", next: "c" })
  .addAgentStep({ id: "c", agent: "c", emits: "c", next: "analytics-late-stage" })
  .addAgentStep({ id: "analytics-late-stage", agent: "z", emits: "z" })
  .build();

async function waitFor(check, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout: ${label}`);
}

test("a cold resume at an AWAITING_APPROVAL gate continues from the gate's successor, never an arbitrary pending stage", { timeout: 20000 }, async () => {
  const persistence = new AlphabeticalPersistence();

  // Run 1: reach the gate and stop there (persisted AWAITING_APPROVAL).
  const engine1 = buildEngine(persistence, definition);
  await engine1.start({ definition, trigger: {}, workflowId: "wf-incident" });
  await waitFor(async () => (await persistence.loadWorkflow("wf-incident"))?.state === "AWAITING_APPROVAL", "gate pending");
  const atGate = await persistence.loadWorkflow("wf-incident");
  strictEqual(atGate.steps.find((s) => s.stepId === "gate").status, "running");
  strictEqual(atGate.steps.find((s) => s.stepId === "analytics-late-stage").status, "pending");
  // The persisted step order in storage is alphabetical; recovery must not
  // depend on it.
  const alphabeticalFirstPending = [...atGate.steps].sort((a, b) => a.stepId.localeCompare(b.stepId)).find((s) => s.status === "pending").stepId;
  strictEqual(alphabeticalFirstPending, "analytics-late-stage", "fixture reproduces the incident ordering");

  // Cold resume (a fresh engine process — the incident path).
  const engine2 = buildEngine(persistence, definition);
  const resumed = await engine2.resume("wf-incident");
  strictEqual(resumed.state, "AWAITING_APPROVAL");
  // The recovered frontier retains the awaited gate (not an arbitrary stage).
  ok(resumed.ready.includes("gate"), `frontier retains the gate: ${JSON.stringify(resumed.ready)}`);
  ok(!resumed.ready.includes("analytics-late-stage"), "the spurious downstream stage is NOT in the frontier");

  // Approve the gate on the cold engine: only the successor `b` may run.
  await engine2.signalApproval("wf-incident", { workflowId: "wf-incident", stepId: "gate", outcome: "approved", approver: "owner", note: "approve", decidedAt: new Date().toISOString() });
  await waitFor(async () => {
    const w = await persistence.loadWorkflow("wf-incident");
    return w.state === "COMPLETED";
  }, "chain completes in definition order");
  const after = await persistence.loadWorkflow("wf-incident");
  strictEqual(after.state, "COMPLETED", "the healthy chain completes (the incident outcome was FAILED)");
  strictEqual(after.steps.find((s) => s.stepId === "b").status, "completed", "the gate's true successor ran");
  // Incident signature: the alphabetically-first downstream stage started
  // BEFORE the gate's successor. With the fix it runs only in its legitimate
  // definition position — after `b` and `c` have finished.
  const record = (id) => after.steps.find((s) => s.stepId === id);
  const bFinished = Date.parse(record("b").finishedAt);
  const analyticsStarted = Date.parse(record("analytics-late-stage").startedAt ?? record("analytics-late-stage").finishedAt);
  ok(analyticsStarted >= bFinished, `analytics runs only after the successor chain (analytics started ${analyticsStarted}, b finished ${bFinished})`);
  ok(Date.parse(record("c").finishedAt) <= analyticsStarted, "definition order preserved: b -> c -> analytics");
});

test("the recovery safety net repairs an empty frontier in DEFINITION order, not storage order", { timeout: 20000 }, async () => {
  const persistence = new AlphabeticalPersistence();
  // Persist an instance whose ready frontier is EMPTY with pending work —
  // the safety-net input condition. Definition order: alpha -> gate -> b...
  const now = new Date().toISOString();
  await persistence.saveWorkflow({
    workflowId: "wf-safetynet", definitionId: definition.id, definitionVersion: definition.version,
    state: "RUNNING",
    context: { workflowId: "wf-safetynet", correlationId: null, brandId: null, outputs: {}, data: {} },
    steps: definition.steps.map((step) => ({ stepId: step.id, status: step.id === "alpha" ? "completed" : "pending", attempts: 0, startedAt: null, finishedAt: null })),
    ready: [], lastCheckpointRef: null, createdAt: now, updatedAt: now,
  });
  await persistence.saveCheckpoint({ workflowId: "wf-safetynet", state: "RUNNING", completedSteps: ["alpha"], contextSnapshotRef: "x", lastEventOffset: 1, createdAt: now });

  const engine = buildEngine(persistence, definition);
  const resumed = await engine.resume("wf-safetynet");
  // Definition order: the next step after completed `alpha` is the gate —
  // never `analytics-late-stage` (alphabetically first among pending).
  deepStrictEqual(resumed.ready, ["gate"], `frontier repaired in definition order: ${JSON.stringify(resumed.ready)}`);
});

test("repeated cold resumes without an Owner approval remain fail-closed at the same actionable gate", { timeout: 20000 }, async () => {
  const persistence = new AlphabeticalPersistence();
  const firstEngine = buildEngine(persistence, definition);
  await firstEngine.start({ definition, trigger: {}, workflowId: "wf-repeated-gate" });
  await waitFor(async () => (await persistence.loadWorkflow("wf-repeated-gate"))?.state === "AWAITING_APPROVAL", "initial gate pending");

  const resumedOnce = await buildEngine(persistence, definition).resume("wf-repeated-gate");
  const resumedTwice = await buildEngine(persistence, definition).resume("wf-repeated-gate");

  for (const resumed of [resumedOnce, resumedTwice]) {
    strictEqual(resumed.state, "AWAITING_APPROVAL", "missing Owner approval never advances or fails the workflow");
    strictEqual(resumed.steps.find((step) => step.stepId === "gate").status, "running");
    strictEqual(resumed.steps.find((step) => step.stepId === "b").status, "pending");
    strictEqual(resumed.steps.find((step) => step.stepId === "analytics-late-stage").attempts, 0);
    deepStrictEqual(resumed.ready, ["gate"], "the recovered frontier remains the single actionable gate");
  }
});
