/**
 * Shared production WorkflowWorker bootstrap.
 *
 * THE single construction path for a production-capable worker. Both the
 * production CLI (apps/worker/src/cli.ts) and every operator entry point
 * (e.g. the live revision-cycle runner) must construct their worker through
 * this function so there is exactly one wiring of:
 *
 *   - the production agent executor (durable publishing stores from the pool)
 *   - the canonical agent registry bootstrap
 *   - the authoritative production routing resolver + universal preflight
 *
 * Operator paths must never construct a bare WorkflowWorker with their own
 * (or no) configuration resolution: that divergence once routed a governed
 * Writer stage to an ambient provider instead of its configured task-class
 * policy (Revision v1 incident, 2026-09-13).
 */

import type pg from "pg";
import {
  ApprovalActionabilityStore,
  ControlPlaneStore,
  LifecycleStore,
  PostgresPersistence,
  PostgresQueue,
  PostgresMediaResumeDispatcher,
  StrategicStore,
  TargetedVerificationDispatcher,
  TargetedVerificationReevaluationRecoveryDispatcher,
  VisualIterationStore,
  ProductionModelRoutingStore,
  PostgresWorkerSingletonLease,
  PostgresWorkerDiagnosticListener,
  WanSupervisedExecutionStore,
} from "@ai-media-factory/database";
import { resolveStrategicProjectContext, resolveOperationalContext } from "./project-context.js";
import type { Json } from "@ai-media-factory/shared";
import type { ProviderCapabilityBoundary } from "@ai-media-factory/provider-adapters";
import { runPodVideoAdapterFromEnv } from "@ai-media-factory/provider-adapters";
import { createProductionAgentExecutor, buildProviderBoundary, probeProductionOpenRouterTransport, resolveProductionTtsVoice } from "./production-executor.js";
export { buildProviderBoundary } from "./production-executor.js";
import { WorkflowWorker } from "./worker.js";
import { bootstrapCanonicalAgentRegistry } from "./agent-bootstrap.js";
import { createWorkerRuntimeIdentity, type WorkerRuntimeIdentity, type WorkerRuntimeMode } from "./worker-runtime-identity.js";
import { computeMediaBuildId } from "./media-build-identity.js";
import { createProductionTargetedVerificationRuntime, executeTargetedVerification, createProductionTargetedReevaluationRecoveryRuntime, executeTargetedReevaluationRecovery } from "./targeted-verification.js";
import { CanonicalWanVisualSourceResolver, LocalCanonicalWanOutputPersister, SupervisedWanSingleSceneRunner } from "./supervised-wan-runtime.js";

export interface ProductionWorkerOptions {
  readonly pool: pg.Pool;
  /** Defaults to a new PostgresPersistence over the pool. */
  readonly persistence?: PostgresPersistence;
  /** Defaults to a new PostgresQueue over the pool. */
  readonly queue?: PostgresQueue;
  /** Defaults to a new ControlPlaneStore over the pool. */
  readonly control?: ControlPlaneStore;
  /** Defaults to a new VisualIterationStore over the pool. */
  readonly visualIterations?: VisualIterationStore;
  readonly pollMs?: number;
  readonly orphanStaleMs?: number;
  /**
   * Test/composition-root frozen capability boundary (same seam as
   * ProductionAgentExecutorOptions.providerBoundary). The production CLI and
   * operator paths never pass it; provider boundaries remain injected, never
   * constructed, by media stages.
   */
  readonly providerBoundary?: ProviderCapabilityBoundary;
  /**
   * Operational runtime mode of this worker process. The persistent
   * production launcher passes PERSISTENT_PRODUCTION_WORKER; engineering
   * sessions leave the default (OPERATOR_WORKER, also resolved from
   * AMF_WORKER_RUNTIME_MODE when the option is omitted).
   */
  readonly runtimeMode?: WorkerRuntimeMode;
  /** Safe launcher classification recorded on the worker identity (no secrets). */
  readonly launcher?: string;
}export interface ProductionWorkerRuntime {
  readonly worker: WorkflowWorker;
  readonly persistence: PostgresPersistence;
  readonly queue: PostgresQueue;
  readonly control: ControlPlaneStore;
  /** Resolve the effective stage configuration for a governed project (the production resolver). */
  resolveCommandConfiguration(projectId: string): Promise<Record<string, { provider: string | null; model: string | null; source: string; routingVersionId?: string; routingScope?: string; priceSnapshotId?: string }>>;
  /** The media-resume dispatcher (preflight + authorization + budget port), wired with the REAL capability boundary. */
  readonly mediaResumes: PostgresMediaResumeDispatcher;
  /** Governed Visual Iteration V1 store (creative downstream revision lifecycle). */
  readonly visualIterations: VisualIterationStore;
  /** Durable owner-authorized Research TARGETED_VERIFICATION dispatcher. */
  readonly targetedVerification: TargetedVerificationDispatcher;
  readonly targetedReevaluationRecovery: TargetedVerificationReevaluationRecoveryDispatcher;
  /** Safe runtime identity of this worker process (mode/launcher/instance/node/env — no secrets). */
  readonly identity: WorkerRuntimeIdentity;
  /** Deterministic build id of the deployed dist bundle this worker loaded (file bytes only, no secrets). */
  readonly buildId: string;
  close(): Promise<void>;
}

export async function createProductionWorker(options: ProductionWorkerOptions): Promise<ProductionWorkerRuntime> {
  const persistence = options.persistence ?? new PostgresPersistence(options.pool);
  const queue = options.queue ?? new PostgresQueue(options.pool);
  const control = options.control ?? new ControlPlaneStore(options.pool);
  const identity = createWorkerRuntimeIdentity({ mode: options.runtimeMode, launcher: options.launcher });
  const singletonKey = process.env.AMF_WORKER_SINGLETON_KEY ?? "canonical-production-runtime";
  const workerRole = process.env.AMF_WORKER_ROLE ?? "canonical-production-queue-worker";
  const singletonLease = new PostgresWorkerSingletonLease(options.pool, singletonKey, workerRole);
  if (identity.runtimeMode === "PERSISTENT_PRODUCTION_WORKER") {
    const lease = await singletonLease.acquire();
    if (lease !== "ACQUIRED") throw new Error(`PRODUCTION_WORKER_SINGLETON_ALREADY_HELD:${singletonKey}:${workerRole}`);
  }
  // R7 hardening: deterministic build identity of the deployed bundle.
  // Missing dist fails closed here — an uncertifiable worker must never start.
  const buildId = computeMediaBuildId().buildId;
  // eslint-disable-next-line no-console
  console.log(`[amf-worker] ${identity.workerInstanceId} mode=${identity.runtimeMode} launcher=${identity.launcherClassification} env=${identity.executionEnvironment.status} reason=${identity.executionEnvironment.reasonCodes.join(",") || "NONE"} failed=${identity.executionEnvironment.failedCheckNames.join(",") || "NONE"} node=${identity.nodeVersion} build=${buildId.slice(0, 12)}`);
  // Persist startup presence for pre-authorization build-parity checks.
  // Best-effort: presence must never prevent worker startup (parity is
  // enforced at authorization time, where a missing row fails closed).
  const startedAt = new Date().toISOString();
  const recordPresence = async (heartbeat: boolean): Promise<void> => {
    try {
      await options.pool.query(
        `INSERT INTO amf_worker_presence (worker_instance_id, build_id, runtime_mode, launcher, node_version, started_at, last_heartbeat_at, process_id, singleton_key, worker_role, execution_environment_status, execution_environment_reason_codes, execution_environment_failed_checks, execution_environment_runtime_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
         ON CONFLICT (worker_instance_id) DO UPDATE SET last_heartbeat_at=EXCLUDED.last_heartbeat_at,process_id=EXCLUDED.process_id,singleton_key=EXCLUDED.singleton_key,worker_role=EXCLUDED.worker_role,execution_environment_status=EXCLUDED.execution_environment_status,execution_environment_reason_codes=EXCLUDED.execution_environment_reason_codes,execution_environment_failed_checks=EXCLUDED.execution_environment_failed_checks,execution_environment_runtime_fingerprint=EXCLUDED.execution_environment_runtime_fingerprint`,
        [identity.workerInstanceId, buildId, identity.runtimeMode, identity.launcherClassification, identity.nodeVersion, heartbeat ? new Date().toISOString() : startedAt, process.pid, process.env.AMF_WORKER_SINGLETON_KEY ?? null, process.env.AMF_WORKER_ROLE ?? null, identity.executionEnvironment.status, JSON.stringify(identity.executionEnvironment.reasonCodes), JSON.stringify(identity.executionEnvironment.failedCheckNames), JSON.stringify(identity.executionEnvironment.runtimeFingerprint)],
      );
    } catch { /* best-effort only */ }
  };
  await recordPresence(false);
  const heartbeatTimer = setInterval(() => { void recordPresence(true); }, 60_000);
  if (typeof (heartbeatTimer as unknown as { unref?: () => void }).unref === "function") {
    (heartbeatTimer as unknown as { unref: () => void }).unref();
  }
  // Owner-authorized, non-inference diagnostics use a dedicated PostgreSQL
  // notification channel. The handler executes inside this exact process and
  // never enters the workflow queue, provider budget, or agent runtime.
  const diagnostics = identity.runtimeMode === "PERSISTENT_PRODUCTION_WORKER"
    ? new PostgresWorkerDiagnosticListener(
      options.pool,
      { workerInstanceId:identity.workerInstanceId, workerBuild:buildId, workerPid:process.pid },
      probeProductionOpenRouterTransport,
    )
    : null;
  if (diagnostics) await diagnostics.start();
  // MEDIA CAPABILITY PREFLIGHT V1: construct the REAL production capability
  // boundary ONCE — the SAME exported buildProviderBoundary the production
  // executor uses (identical env selectors, adapters, and registration rules;
  // construction performs no provider I/O) — and inject the SAME object into
  // both the executor and the media-resume dispatcher. The preflight's
  // registration view is therefore, by construction, the live runtime's view.
  const providerBoundary = options.providerBoundary ?? buildProviderBoundary({
    persistence,
    workerRuntimeMode: identity.runtimeMode,
    workerLauncher: identity.launcherClassification,
    workerInstanceId: identity.workerInstanceId,
  });
  // Media Technical Resume V1: the durable provider-budget port (only active
  // when a media-resume marker is present on a workflow), preflight-wired
  // with the real capability boundary and the governed voice resolver (so
  // the durable v2 fingerprint carries effective-voice lineage).
  const mediaResumeBudget = new PostgresMediaResumeDispatcher(options.pool, persistence, providerBoundary, {
    resolveVoice: (value, workflowId) => resolveProductionTtsVoice(value, workflowId),
  });
  const executor = createProductionAgentExecutor({ persistence, pool: options.pool, providerBoundary, mediaResumeBudget });
  await bootstrapCanonicalAgentRegistry({ executor });
  const modelRouting = new ProductionModelRoutingStore(options.pool);
  const resolveCommandConfiguration = (projectId: string) => modelRouting.configurationMap(projectId);
  const preflightGovernedCommand = async (input: { projectId: string; role: string; provider: "agentrouter" | "openrouter"; model: string; routingVersionId?: string; prompt: string; system: string; outputTokens: number }) => {
    if (input.provider !== "openrouter") throw new Error("LLM_PREFLIGHT_FAILED:PROVIDER_PROTOCOL_INCOMPATIBLE");
    const verdict = await modelRouting.preflight(input.role, {
      projectId: input.projectId,
      expectedRoutingVersionId: input.routingVersionId,
      expectedModel: input.model,
      requirements: {
        executionType: "LLM", executionEnvironmentAllowed: identity.executionEnvironment.status === "SUPPORTED",
        prompt: `${input.system}\n${input.prompt}`, expectedOutputTokens: input.outputTokens,
        structuredOutput: "PROMPT_JSON", allowPromptJson: true,
        requiredProtocol: "OPENAI_COMPATIBLE",
        requiredInputModality: "text", requiredOutputModality: "text",
      },
    });
    return { fingerprint: verdict.configurationFingerprint };
  };
  const strategic = new StrategicStore(options.pool);
  const resolveStrategicContext = (
    projectId: string, agentId: string, requested: unknown, operational?: Record<string, Json> | null,
  ) => resolveStrategicProjectContext(strategic, projectId, requested, agentId, operational ?? null);
  const actionability = new ApprovalActionabilityStore(options.pool);
  const lifecycleReader = new LifecycleStore(options.pool);
  const resolveOperational = (projectId: string): Promise<Record<string, Json> | null> =>
    resolveOperationalContext(
      {
        listApprovals: (pid) => control.listApprovals(pid),
        approvalActionability: (approvalId) => actionability.approvalActionability(approvalId),
        projectLifecycles: (pid, limit) => lifecycleReader.projectLifecycles(pid, limit),
      },
      projectId,
    );
  const visualIterations = options.visualIterations ?? new VisualIterationStore(options.pool);
  const targetedVerification = new TargetedVerificationDispatcher(options.pool);
  const targetedReevaluationRecovery = new TargetedVerificationReevaluationRecoveryDispatcher(options.pool);
  const targetedVerificationRuntime = createProductionTargetedVerificationRuntime({
    pool: options.pool,
    persistence,
    providerBoundary,
  });
  const targetedReevaluationRecoveryRuntime=createProductionTargetedReevaluationRecoveryRuntime({pool:options.pool,persistence});
  const supervisedWan=process.env.WAN_OPERATION_MODE==="TEMPORARY_GOVERNED_LEGACY_ENDPOINT"
    ?new SupervisedWanSingleSceneRunner(
      new WanSupervisedExecutionStore(options.pool),
      (_execution,lifecycle)=>runPodVideoAdapterFromEnv(undefined,async event=>{try{if(event.state==="ACKNOWLEDGED")await lifecycle.acknowledged(event.providerJobId);else await lifecycle.generating(event.providerJobId)}catch{throw Object.assign(new Error("WAN_LIFECYCLE_PERSISTENCE_FAILED"),{reconciliationRequired:true})}}),
      new CanonicalWanVisualSourceResolver(persistence),
      identity.workerInstanceId,
      new LocalCanonicalWanOutputPersister(persistence),
    ):undefined;
  const worker = new WorkflowWorker({
    queue,
    persistence,
    executor,
    control,
    visualIterations,
    targetedVerification: {
      byJobId: (jobId) => targetedVerification.byJobId(jobId),
      markRunning: (dispatchId) => targetedVerification.markRunning(dispatchId),
      execute: (dispatch) => executeTargetedVerification(dispatch, targetedVerificationRuntime),
      settle: (dispatchId, status, revisionId, errorCode) => targetedVerification.settle(dispatchId, status, revisionId, errorCode),
    },
    targetedReevaluationRecovery:{
      byJobId:(jobId)=>targetedReevaluationRecovery.byJobId(jobId),
      markRunning:(recoveryId)=>targetedReevaluationRecovery.markRunning(recoveryId),
      execute:(recovery)=>executeTargetedReevaluationRecovery(recovery,targetedReevaluationRecoveryRuntime),
      settle:(recoveryId,status,revisionId,errorCode,routeSnapshot)=>targetedReevaluationRecovery.settle(recoveryId,status,revisionId,errorCode,routeSnapshot),
    },
    resolveCommandConfiguration,
    preflightGovernedCommand,
    resolveOperationalContext: resolveOperational,
    resolveStrategicContext,
    workerInstanceId: identity.workerInstanceId,
    ...(supervisedWan?{supervisedWan}:{}),
    ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
    ...(options.orphanStaleMs !== undefined ? { orphanStaleMs: options.orphanStaleMs } : {}),
  });
  return {
    worker,
    persistence,
    queue,
    control,
    resolveCommandConfiguration,
    mediaResumes: mediaResumeBudget,
    visualIterations,
    targetedVerification,
    targetedReevaluationRecovery,
    identity,
    buildId,
    close: async () => {
      clearInterval(heartbeatTimer);
      if (diagnostics) await diagnostics.close();
      await singletonLease.release();
      await persistence.close();
    },
  };
}
