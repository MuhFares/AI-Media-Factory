/**
 * Worker CLI — run as:  node dist/cli.js
 *
 * Consumes durable queue jobs and runs them through the durable Workflow Engine.
 * On startup it first reclaims orphaned (crashed) running jobs, then polls the
 * queue until stopped.
 *
 * The worker is constructed exclusively through the shared production bootstrap
 * (createProductionWorker) so the CLI and every operator entry point share one
 * authoritative runtime-configuration wiring.
 */

import { createPool, migrate } from "@ai-media-factory/database";
import { createProductionWorker } from "./production-worker.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
function safeDatabaseTarget(value: string): string { try { const url = new URL(value); return `${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`; } catch { return "configured PostgreSQL database"; } }

export async function main(): Promise<void> {
  const pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);

  const runtime = await createProductionWorker({ pool });
  const worker = runtime.worker;

  const shutdown = (): void => {
    worker.stop();
    setTimeout(() => {
      void runtime.close().then(() => process.exit(0));
    }, 200);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // eslint-disable-next-line no-console
  console.log(`worker: polling PostgreSQL queue at ${safeDatabaseTarget(DATABASE_URL)}`);
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
