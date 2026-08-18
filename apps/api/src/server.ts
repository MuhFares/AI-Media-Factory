/**
 * API HTTP server — run as:  node dist/server.js
 *
 * Exposes the Phase 1 workflow submission + query endpoints. Enqueues durable
 * jobs (never executes synchronously); the worker consumes them.
 */

import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "./handler.js";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 8080);

export async function startServer(opts: { host?: string; port?: number } = {}): Promise<{ close: () => Promise<void> }> {
  const pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);

  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const handler = createWorkflowApiHandler({ persistence, queue });

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
