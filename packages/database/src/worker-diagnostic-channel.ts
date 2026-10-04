import { randomUUID } from "node:crypto";
import type pg from "pg";

export const WORKER_DIAGNOSTIC_COMMAND = "PROBE_OPENROUTER_EGRESS" as const;
export const WORKER_DIAGNOSTIC_REQUEST_CHANNEL = "amf_worker_diagnostic_request";
export const WORKER_DIAGNOSTIC_RESULT_CHANNEL = "amf_worker_diagnostic_result";
export const WORKER_DIAGNOSTIC_COOLDOWN_MS = 10_000;

export interface WorkerDiagnosticResult {
  readonly requestId: string;
  readonly command: typeof WORKER_DIAGNOSTIC_COMMAND;
  readonly timestamp: string;
  readonly workerInstanceId: string;
  readonly workerPid: number;
  readonly workerBuild: string;
  readonly dnsStatus: "PASS" | "FAIL" | "UNKNOWN";
  readonly tcpStatus: "PASS" | "FAIL" | "UNKNOWN";
  readonly tlsStatus: "PASS" | "FAIL" | "UNKNOWN";
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  readonly errorClass: string | null;
  readonly errorCode: string | null;
  readonly providerReached: boolean;
  readonly authValid: boolean | null;
  readonly outcome: "PASS" | "FAIL" | "PROBE_ALREADY_ACTIVE" | "PROBE_COOLDOWN_ACTIVE";
}

type ProbeRequest = {
  requestId: string;
  command: typeof WORKER_DIAGNOSTIC_COMMAND;
  requestedAt: string;
};

type Notification = { channel: string; payload?: string };
type DiagnosticClient = pg.PoolClient & {
  on(event: "notification", listener: (notification: Notification) => void): DiagnosticClient;
  on(event: "error", listener: (error: Error) => void): DiagnosticClient;
  off(event: "notification", listener: (notification: Notification) => void): DiagnosticClient;
  off(event: "error", listener: (error: Error) => void): DiagnosticClient;
};

export class WorkerDiagnosticGuard {
  private active = false;
  private lastCompletedAt = 0;
  constructor(private readonly cooldownMs = WORKER_DIAGNOSTIC_COOLDOWN_MS, private readonly now = () => Date.now()) {}
  enter(): "ENTERED" | "PROBE_ALREADY_ACTIVE" | "PROBE_COOLDOWN_ACTIVE" {
    if (this.active) return "PROBE_ALREADY_ACTIVE";
    if (this.lastCompletedAt > 0 && this.now() - this.lastCompletedAt < this.cooldownMs) return "PROBE_COOLDOWN_ACTIVE";
    this.active = true;
    return "ENTERED";
  }
  complete(): void { this.active = false; this.lastCompletedAt = this.now(); }
}

export class PostgresWorkerDiagnosticClient {
  constructor(private readonly pool: pg.Pool, private readonly timeoutMs = 20_000) {}

  async probeOpenRouterEgress(): Promise<WorkerDiagnosticResult> {
    const client = await this.pool.connect() as DiagnosticClient;
    const request: ProbeRequest = {
      requestId: `worker-diagnostic-${randomUUID()}`,
      command: WORKER_DIAGNOSTIC_COMMAND,
      requestedAt: new Date().toISOString(),
    };
    let timer: NodeJS.Timeout | undefined;
    try {
      await client.query(`LISTEN ${WORKER_DIAGNOSTIC_RESULT_CHANNEL}`);
      const result = new Promise<WorkerDiagnosticResult>((resolve, reject) => {
        const listener = (notification: Notification): void => {
          if (notification.channel !== WORKER_DIAGNOSTIC_RESULT_CHANNEL || !notification.payload) return;
          try {
            const parsed = JSON.parse(notification.payload) as WorkerDiagnosticResult;
            if (parsed.requestId !== request.requestId) return;
            client.off("notification", listener);
            resolve(parsed);
          } catch { /* unrelated or malformed notification: ignore */ }
        };
        client.on("notification", listener);
        timer = setTimeout(() => {
          client.off("notification", listener);
          reject(new Error("WORKER_DIAGNOSTIC_TIMEOUT"));
        }, this.timeoutMs);
      });
      await client.query("SELECT pg_notify($1,$2)", [WORKER_DIAGNOSTIC_REQUEST_CHANNEL, JSON.stringify(request)]);
      return await result;
    } finally {
      if (timer) clearTimeout(timer);
      try { await client.query(`UNLISTEN ${WORKER_DIAGNOSTIC_RESULT_CHANNEL}`); } catch { /* connection is being released */ }
      client.release();
    }
  }
}

export class PostgresWorkerDiagnosticListener {
  private client: DiagnosticClient | null = null;
  private readonly guard: WorkerDiagnosticGuard;
  private notificationListener: ((notification: Notification) => void) | null = null;
  private errorListener: ((error: Error) => void) | null = null;

  constructor(
    private readonly pool: pg.Pool,
    private readonly identity: { workerInstanceId: string; workerBuild: string; workerPid: number },
    private readonly probe: () => Promise<{
      httpStatus: number; latencyMs: number; providerReached: boolean; authValid: boolean | null;
    }>,
    options: { cooldownMs?: number; now?: () => number } = {},
  ) {
    this.guard = new WorkerDiagnosticGuard(options.cooldownMs, options.now);
  }

  async start(): Promise<void> {
    if (this.client) return;
    const client = await this.pool.connect() as DiagnosticClient;
    const listener = (notification: Notification): void => {
      if (notification.channel !== WORKER_DIAGNOSTIC_REQUEST_CHANNEL || !notification.payload) return;
      void this.handle(client, notification.payload);
    };
    const errorListener = (error: Error): void => { this.handleClientError(client,error); };
    client.on("notification", listener);
    client.on("error", errorListener);
    await client.query(`LISTEN ${WORKER_DIAGNOSTIC_REQUEST_CHANNEL}`);
    this.client = client;
    this.notificationListener = listener;
    this.errorListener = errorListener;
  }

  /** A lost dedicated LISTEN connection disables diagnostics fail-closed but
   * must never crash the workflow worker through EventEmitter's special
   * unhandled `error` semantics. A later controlled worker refresh reopens it. */
  private handleClientError(client: DiagnosticClient,error: Error): void {
    const safe=safeDiagnosticError(error);
    if(this.client===client)this.client=null;
    if(this.notificationListener)client.off("notification",this.notificationListener);
    if(this.errorListener)client.off("error",this.errorListener);
    this.notificationListener=null;this.errorListener=null;
    client.release(true);
    // eslint-disable-next-line no-console
    console.error(`[amf-worker-diagnostic] listener disabled after database error class=${safe.errorClass} code=${safe.errorCode??"UNKNOWN"}`);
  }

  private async handle(client: DiagnosticClient, payload: string): Promise<void> {
    let request: ProbeRequest;
    try { request = JSON.parse(payload) as ProbeRequest; } catch { return; }
    if (request.command !== WORKER_DIAGNOSTIC_COMMAND || !request.requestId?.startsWith("worker-diagnostic-")) return;
    const entered = this.guard.enter();
    if (entered !== "ENTERED") {
      await this.publish(client, request, {
        outcome: entered, dnsStatus:"UNKNOWN", tcpStatus:"UNKNOWN", tlsStatus:"UNKNOWN",
        httpStatus:null, latencyMs:0, errorClass:entered, errorCode:entered,
        providerReached:false, authValid:null,
      });
      return;
    }
    try {
      const result = await this.probe();
      await this.publish(client, request, {
        outcome: result.httpStatus === 200 && result.authValid === true ? "PASS" : "FAIL",
        dnsStatus:"PASS", tcpStatus:"PASS", tlsStatus:"PASS",
        httpStatus:result.httpStatus, latencyMs:result.latencyMs,
        errorClass:null, errorCode:null, providerReached:result.providerReached, authValid:result.authValid,
      });
    } catch (error) {
      const safe = safeDiagnosticError(error);
      await this.publish(client, request, {
        outcome:"FAIL", dnsStatus:safe.phase === "DNS" ? "FAIL" : "UNKNOWN",
        tcpStatus:safe.phase === "TCP" || safe.phase === "LOCAL_NETWORK_POLICY" ? "FAIL" : "UNKNOWN",
        tlsStatus:safe.phase === "TLS" ? "FAIL" : "UNKNOWN", httpStatus:null,
        latencyMs:0, errorClass:safe.errorClass, errorCode:safe.errorCode,
        providerReached:false, authValid:null,
      });
    } finally { this.guard.complete(); }
  }

  private async publish(client: DiagnosticClient, request: ProbeRequest, result: Omit<WorkerDiagnosticResult,"requestId"|"command"|"timestamp"|"workerInstanceId"|"workerPid"|"workerBuild">): Promise<void> {
    const safe: WorkerDiagnosticResult = {
      requestId:request.requestId, command:WORKER_DIAGNOSTIC_COMMAND, timestamp:new Date().toISOString(),
      workerInstanceId:this.identity.workerInstanceId, workerPid:this.identity.workerPid, workerBuild:this.identity.workerBuild,
      ...result,
    };
    await client.query("SELECT pg_notify($1,$2)", [WORKER_DIAGNOSTIC_RESULT_CHANNEL, JSON.stringify(safe)]);
  }

  async close(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    if (this.notificationListener) client.off("notification", this.notificationListener);
    if (this.errorListener) client.off("error", this.errorListener);
    this.notificationListener = null;
    this.errorListener = null;
    try { await client.query(`UNLISTEN ${WORKER_DIAGNOSTIC_REQUEST_CHANNEL}`); } finally { client.release(); }
  }
}

function safeDiagnosticError(error: unknown): { phase:string; errorClass:string; errorCode:string|null } {
  const visited=new Set<object>();const chain:Array<Record<string,unknown>>=[];
  const visit=(value:unknown):void=>{if(!value||typeof value!=="object"||visited.has(value))return;visited.add(value);const item=value as Record<string,unknown>;chain.push(item);if(Array.isArray(item.errors))item.errors.forEach(visit);visit(item.cause)};
  visit(error);
  const code = chain.map(item=>item.code).find(value=>typeof value==="string"&&/^[A-Za-z0-9_.-]{1,80}$/.test(value)) as string|undefined;
  const upper = String(code ?? "").toUpperCase();
  const phase = /ENOTFOUND|EAI_AGAIN/.test(upper) ? "DNS" : /CERT|TLS/.test(upper) ? "TLS"
    : /EACCES|EPERM/.test(upper) ? "LOCAL_NETWORK_POLICY" : "TCP";
  const rawName=chain.map(item=>item.name).find(value=>typeof value==="string"&&/^[A-Za-z0-9_.-]{1,80}$/.test(value));
  return { phase, errorClass:typeof rawName==="string"?rawName:"Error", errorCode:code??null };
}
