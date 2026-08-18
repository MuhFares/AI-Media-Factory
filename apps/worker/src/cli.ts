/**
 * Worker CLI — run as:  node dist/cli.js
 *
 * Consumes durable queue jobs and runs them through the durable Workflow Engine.
 * On startup it first reclaims orphaned (crashed) running jobs, then polls the
 * queue until stopped.
 */

import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createDeterministicAgentExecutor } from "./executor.js";
import { WorkflowWorker } from "./worker.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";

export async function main(): Promise<void> {
  const pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);

  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const executor = createDeterministicAgentExecutor(persistence);

  const worker = new WorkflowWorker({ queue, persistence, executor });

  const shutdown = (): void => {
    worker.stop();
    setTimeout(() => {
      void persistence.close().then(() => process.exit(0));
    }, 200);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // eslint-disable-next-line no-console
  console.log(`worker: polling ${DATABASE_URL}`);
  await worker.runLoop();
}

import { fileURLToPath } from "node:url";
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  void main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
