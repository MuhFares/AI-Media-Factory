/**
 * API HTTP server — run as:  node dist/server.js
 *
 * Exposes the Phase 1 workflow submission + query endpoints. Enqueues durable
 * jobs (never executes synchronously); the worker consumes them.
 */

import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, PostgresRevisionDispatcher, PostgresReviewResumeDispatcher, PostgresMediaResumeDispatcher, StrategicStore, LifecycleStore, ApprovalActionabilityStore, LearningLoopStore, ContentStore, SubjectStore, ChannelStore, AutomationStore, ModelIntelligenceStore, ModelBenchmarkRuntimeStore, ProductionCallBudgetStore, ProductionModelRoutingStore, OwnerAutonomyStore } from "@ai-media-factory/database";
import { buildProviderBoundary } from "@ai-media-factory/worker";
import { createWorkflowApiHandler } from "./handler.js";
import { ProductionCredentialHealthVerifier } from "./credential-health-verifier.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 8080);

export async function startServer(opts: { host?: string; port?: number } = {}): Promise<{ close: () => Promise<void> }> {
  const pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);

  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const handler = createWorkflowApiHandler({
    persistence,
    queue,
    control: new ControlPlaneStore(pool),
    strategic: new StrategicStore(pool),
    lifecycle: new LifecycleStore(pool),
    actionability: new ApprovalActionabilityStore(pool),
    learning: new LearningLoopStore(pool),
    content: new ContentStore(pool),
    subjects: new SubjectStore(pool),
    channels: new ChannelStore(pool),
    automation: new AutomationStore(pool),
    modelIntelligence: new ModelIntelligenceStore(pool),
    modelBenchmarkRuntime: new ModelBenchmarkRuntimeStore(pool),
    productionModelRouting: new ProductionModelRoutingStore(pool),
    productionCallBudgets: new ProductionCallBudgetStore(pool),
    ownerAutonomy: new OwnerAutonomyStore(pool),
    credentialHealthVerifier: new ProductionCredentialHealthVerifier(),
    revisions: new PostgresRevisionDispatcher(pool, persistence),
    reviewResumes: new PostgresReviewResumeDispatcher(pool, persistence),
    // MEDIA CAPABILITY PREFLIGHT V1: the dispatcher is wired with the REAL
    // production capability boundary (the same exported builder the worker
    // uses; construction performs no provider I/O), so the authorization
    // preflight sees exactly what the live runtime would execute.
    mediaResumes: new PostgresMediaResumeDispatcher(pool, persistence, buildProviderBoundary({ persistence })),
  });

  const server = createServer((req, res) => {
    void handler(req, res);
  });

  const host = opts.host ?? HOST;
  const port = opts.port ?? PORT;
  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  // eslint-disable-next-line no-console
  console.log(`api: listening on http://${host}:${port}`);

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await persistence.close();
    },
  };
}

import { fileURLToPath } from "node:url";
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  void startServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
