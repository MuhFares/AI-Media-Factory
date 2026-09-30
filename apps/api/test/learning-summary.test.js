/**
 * M2 learning summary route (no DB): fake learning store + real handler.
 * Proves the read-only bounded summary, 503 when unconfigured, and that
 * the route performs no mutation.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

let server, base;
function start(deps) {
  const handler = createWorkflowApiHandler(deps);
  server = createServer((req, res) => void handler(req, res));
  return new Promise((r) => server.listen(0, "127.0.0.1", () => {
    base = `http://127.0.0.1:${server.address().port}`;
    r();
  }));
}
async function get(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

test("learning summary returns bounded read-only lists", async () => {
  const calls = [];
  const learning = {
    listObservations: async (p, n) => { calls.push(["obs", p, n]); return [{ observationId: "obs-1" }]; },
    listLearnings: async (p, n) => { calls.push(["learn", p, n]); return []; },
    listRecommendations: async (p, n) => { calls.push(["rec", p, n]); return []; },
    listProposals: async (p, n) => { calls.push(["prop", p, n]); return []; },
  };
  await start({ learning });
  try {
    const r = await get("/control/learning/summary?projectId=morroway");
    assert.equal(r.status, 200);
    assert.equal(r.body.projectId, "morroway");
    assert.deepEqual(r.body.observations, [{ observationId: "obs-1" }]);
    assert.ok(calls.every((c) => c[1] === "morroway" && c[2] === 20), "bounded project-scoped reads");
    const bad = await get("/control/learning/summary");
    assert.equal(bad.status, 400);
  } finally { await new Promise((r) => server.close(r)); }
});

test("learning summary is 503 when store unconfigured, never writes", async () => {
  await start({});
  try {
    const r = await get("/control/learning/summary?projectId=morroway");
    assert.equal(r.status, 503);
  } finally { await new Promise((r) => server.close(r)); }
});
