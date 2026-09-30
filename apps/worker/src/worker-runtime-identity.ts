import { randomUUID } from "node:crypto";
import { inspectWorkerExecutionEnvironment, type WorkerExecutionEnvironment } from "./worker-execution-environment.js";

/**
 * Persistent production worker runtime identity (safe metadata only).
 *
 * Lets future live evidence answer WHICH WORKER EXECUTED THIS PROVIDER
 * SUBMISSION without inference: the mode/launcher classification travels
 * on the shared provider boundary (reported by the zero-network preflight)
 * and is logged once at worker startup. Never carries secrets, credentials,
 * environment dumps, or command lines.
 */

export type WorkerRuntimeMode = "PERSISTENT_PRODUCTION_WORKER" | "OPERATOR_WORKER";

/** Explicit opt-in marker value selecting the persistent operational mode. */
export const PERSISTENT_WORKER_MODE_MARKER = "persistent-production-worker";

export interface WorkerRuntimeIdentity {
  readonly workerInstanceId: string;
  readonly runtimeMode: WorkerRuntimeMode;
  readonly launcherClassification: string;
  readonly nodeVersion: string;
  readonly executionEnvironment: WorkerExecutionEnvironment;
  readonly startedAt: string;
}

/** Canonical boundary/reporting view of the identity (safe strings only). */
export interface WorkerRuntimeReport {
  readonly mode: string;
  readonly launcherClassification: string;
  readonly instanceId: string;
  readonly nodeVersion: string;
}

export function resolveWorkerRuntimeMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerRuntimeMode {
  return env.AMF_WORKER_RUNTIME_MODE?.trim().toLowerCase() === PERSISTENT_WORKER_MODE_MARKER
    ? "PERSISTENT_PRODUCTION_WORKER"
    : "OPERATOR_WORKER";
}

export function resolveWorkerLauncher(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const raw = env.AMF_WORKER_LAUNCHER?.trim();
  return (raw === undefined || raw === "" ? "unspecified" : raw).slice(0, 80);
}

export function createWorkerRuntimeIdentity(input: {
  readonly mode?: WorkerRuntimeMode;
  readonly launcher?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
} = {}): WorkerRuntimeIdentity {
  const env = input.env ?? process.env;
  return {
    workerInstanceId: randomUUID(),
    runtimeMode: input.mode ?? resolveWorkerRuntimeMode(env),
    launcherClassification: (input.launcher ?? resolveWorkerLauncher(env)).slice(0, 80),
    nodeVersion: process.version,
    executionEnvironment: inspectWorkerExecutionEnvironment(env),
    startedAt: new Date().toISOString(),
  };
}

export function workerRuntimeReport(identity: WorkerRuntimeIdentity): WorkerRuntimeReport {
  return {
    mode: identity.runtimeMode,
    launcherClassification: identity.launcherClassification,
    instanceId: identity.workerInstanceId,
    nodeVersion: identity.nodeVersion,
  };
}

/** Single safe startup line: classifications + instance id + node version. No secrets. */
export function safeWorkerRuntimeSummary(identity: WorkerRuntimeIdentity): string {
  return `worker: mode=${identity.runtimeMode} instance=${identity.workerInstanceId} ` +
    `launcher=${identity.launcherClassification} env=${identity.executionEnvironment.status} ` +
    `node=${identity.nodeVersion}`;
}
