/**
 * Default durable Workflow Engine factory for the async worker.
 *
 * Wires every engine collaborator onto the PersistencePort so execution is
 * durable: each step is checkpointed and persisted, artifacts + capability
 * evidence are recorded, and a crash leaves an in-flight step pending so
 * resume() re-runs it idempotently.
 */

import {
  DefaultApprovalCoordinator,
  DefaultAuditTrail,
  DefaultBranchRouter,
  DefaultCheckpointCoordinator,
  DefaultCompensationRunner,
  DefaultDeadLetterSink,
  DefaultRecoveryManager,
  DefaultScheduler,
  DefaultStepExecutor,
  DefaultTimeoutController,
  DefaultWorkflowEngine,
  DefaultWorkflowEventBridge,
  DefaultWorkflowLogger,
  DefaultWorkflowMetrics,
  DefaultWorkflowRetryPolicy,
  DefaultWorkflowStateMachine,
  type PersistencePort,
  type WorkflowDefinition,
} from "@ai-media-factory/workflow-engine";
import type { AgentExecutorPort } from "@ai-media-factory/shared";

export interface BuildEngineDeps {
  readonly persistence: PersistencePort;
  readonly executor: AgentExecutorPort;
  readonly definitionLoader: (definitionId: string, version: number) => Promise<WorkflowDefinition | null>;
}

export function buildDefaultEngine(deps: BuildEngineDeps): DefaultWorkflowEngine {
  const scheduler = new DefaultScheduler();
  const stateMachine = new DefaultWorkflowStateMachine();
  const timeoutController = new DefaultTimeoutController();
  const retryPolicy = new DefaultWorkflowRetryPolicy();
  const branchRouter = new DefaultBranchRouter();
  const checkpointCoordinator = new DefaultCheckpointCoordinator(deps.persistence);
  const recoveryManager = new DefaultRecoveryManager(
    checkpointCoordinator,
    deps.persistence,
    deps.definitionLoader
  );
  const stepExecutor = new DefaultStepExecutor(
    deps.executor,
    branchRouter,
    scheduler,
    timeoutController,
    retryPolicy,
    checkpointCoordinator,
    async (id) => deps.persistence.loadWorkflow(id),
    stateMachine
  );
  const compensationRunner = new DefaultCompensationRunner(() => null, async () => {});
  const approvalCoordinator = new DefaultApprovalCoordinator(async () => {});
  const eventBridge = new DefaultWorkflowEventBridge(async () => {});
  const deadLetterSink = new DefaultDeadLetterSink(eventBridge);
  const auditTrail = new DefaultAuditTrail();
  const logger = new DefaultWorkflowLogger();
  const metrics = new DefaultWorkflowMetrics();

  return new DefaultWorkflowEngine(
    stepExecutor,
    scheduler,
    stateMachine,
    checkpointCoordinator,
    recoveryManager,
    compensationRunner,
    approvalCoordinator,
    deadLetterSink,
    auditTrail,
    logger,
    metrics,
    eventBridge,
    deps.persistence,
    deps.definitionLoader
  );
}

export type WorkflowTerminalState = "COMPLETED" | "FAILED" | "CANCELLED";
const TERMINAL = new Set<WorkflowTerminalState>(["COMPLETED", "FAILED", "CANCELLED"]);

export async function waitForTerminal(
  engine: DefaultWorkflowEngine,
  workflowId: string,
  pollMs = 100,
  timeoutMs = 60000
): Promise<{ state: WorkflowTerminalState }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const instance = await engine.describe(workflowId);
    if (instance && TERMINAL.has(instance.state as WorkflowTerminalState)) {
      return { state: instance.state as WorkflowTerminalState };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out waiting for terminal state on ${workflowId}`);
}

/**
 * Poll the durable (persisted) workflow instance until it reaches a terminal
 * state. Unlike `waitForTerminal` (which reads the engine's in-memory cache),
 * this reads PostgreSQL directly, so the caller never acks a job before the
 * terminal state is durably committed — critical for crash safety.
 */
export async function waitForTerminalState(
  persistence: Pick<PersistencePort, "loadWorkflow">,
  workflowId: string,
  pollMs = 100,
  timeoutMs = 60000
): Promise<WorkflowTerminalState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const instance = await persistence.loadWorkflow(workflowId);
    if (instance && TERMINAL.has(instance.state as WorkflowTerminalState)) {
      return instance.state as WorkflowTerminalState;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out waiting for terminal state on ${workflowId}`);
}
