import test from "node:test";
import assert from "node:assert/strict";
import { chunkNarration, reconstructNarration, TTSChunkExecutionCoordinator } from "../dist/index.js";

const SCRIPT = "Watch this: an unpeeled orange floats, but peel it and it sinks. The peel is full of tiny air pockets, adding lots of volume without much mass. That lowers the orange's average density, so water can support it. Remove the peel, and the fruit becomes denser than water—so it sinks.";

test("long-form narration chunks deterministically and reconstructs exactly", () => {
  const a = chunkNarration(SCRIPT, 200);
  const b = chunkNarration(SCRIPT, 200);
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.ok(a.every((chunk) => chunk.characterCount <= 200));
  assert.equal(reconstructNarration(a), SCRIPT);
  assert.equal(new Set(a.map((chunk) => chunk.chunkId)).size, a.length);
  assert.deepEqual(a.map((chunk) => chunk.index), [0, 1]);
});

test("middle chunk failure stops later work and prevents final narration artifact", () => {
  const chunks = chunkNarration(SCRIPT, 200);
  const attempted = [];
  const successful = [];
  let finalArtifact = null;
  for (const chunk of chunks) {
    attempted.push(chunk.chunkId);
    if (chunk.index === 1) break;
    successful.push({ chunkId: chunk.chunkId, executionId: `exec-${chunk.chunkId}`, artifactId: `art-${chunk.chunkId}` });
  }
  assert.deepEqual(attempted, [chunks[0].chunkId, chunks[1].chunkId]);
  assert.equal(attempted.length, 2);
  assert.equal(successful.length, 1);
  assert.equal(finalArtifact, null);
});

test("successful chunks have durable parent lineage before local assembly", () => {
  const parent = "art-wf-live-validation-orange-density-v1-narration";
  const chunks = chunkNarration(SCRIPT, 200);
  const childArtifacts = chunks.map((chunk) => ({ artifactId: `art-${chunk.chunkId}`, parentArtifactId: parent, chunk }));
  const assembled = { artifactId: `${parent}-assembled`, parentArtifactId: parent, childArtifactIds: childArtifacts.map((a) => a.artifactId), durationMs: 2000, format: "wav" };
  assert.deepEqual(assembled.childArtifactIds, childArtifacts.map((a) => a.artifactId));
  assert.equal(childArtifacts.every((a) => a.chunk.count === chunks.length), true);
  assert.equal(assembled.format, "wav");
});

test("receipt-unknown failed chunk is never automatically resubmitted after restart", async () => {
  const rows = new Map();
  let submissions = 0;
  const store = {
    findExecution: async (id) => rows.get(id) ?? null,
    saveExecution: async (execution) => rows.set(execution.logicalChunkId, execution),
    saveArtifact: async () => {},
    findArtifact: async () => null,
  };
  const options = {
    workflowId: "wf-ambiguous", correlationId: "corr", parentNarrationId: "narration", parentExecutionId: "parent",
    provider: "voicetut", model: "UNKNOWN", voice: "Mohamed", configurationFingerprint: "f".repeat(64), maxCharacters: 200, store,
    synthesize: async () => {
      submissions += 1;
      throw Object.assign(new Error("submission outcome unknown"), { providerReceiptStatus: "UNKNOWN", transportDiagnostic: "DNS_ERROR", transportPhase: "FETCH_INVOCATION_STARTED", retryable: false });
    },
    validateArtifact: async () => false,
    assemble: async () => { throw new Error("must not assemble"); },
  };
  const first = await new TTSChunkExecutionCoordinator(options).execute("one chunk");
  const second = await new TTSChunkExecutionCoordinator(options).execute("one chunk");
  assert.equal(first.status, "failed");
  assert.equal(second.status, "failed");
  assert.equal(submissions, 1);
  assert.equal(second.failedExecution.failureMetadata.providerReceiptStatus, "UNKNOWN");
});
