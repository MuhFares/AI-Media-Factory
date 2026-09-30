/** Read-only official OpenRouter catalog refresh. Never invokes a model. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool, migrate, ModelIntelligenceStore } from "@ai-media-factory/database";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}
const sourceUrl = "https://openrouter.ai/api/v1/models";
const response = await fetch(sourceUrl, { headers: { Accept: "application/json" } });
if (!response.ok) throw new Error(`OpenRouter catalog HTTP ${response.status}`);
const payload = await response.json();
if (!Array.isArray(payload.data)) throw new Error("OpenRouter catalog did not contain data[]");
const pool = createPool({ connectionString: process.env.DATABASE_URL });
try { await migrate(pool); const result = await new ModelIntelligenceStore(pool).ingestProviderCatalog({ provider: "openrouter", sourceUrl, retrievedAt: new Date().toISOString(), models: payload.data }); console.log(JSON.stringify({ provider: "openrouter", metadataOnly: true, ...result })); }
finally { await pool.end(); }
