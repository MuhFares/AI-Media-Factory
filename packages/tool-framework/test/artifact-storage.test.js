import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import {
  LocalDurableObjectStorage,
  LOCAL_DURABLE_TEST_ACKNOWLEDGEMENT,
  canonicalStorageKey,
} from "../dist/index.js";

let root;
let backend;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "amf-durable-test-"));
  backend = new LocalDurableObjectStorage({ root, testOnlyAcknowledgement: LOCAL_DURABLE_TEST_ACKNOWLEDGEMENT });
});

after(async () => { await rm(root, { recursive: true, force: true }); });

function request(bytes = Buffer.from("canonical durable bytes"), overrides = {}) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    artifactId: `artifact-${randomUUID()}`,
    sha256,
    bytes: bytes.byteLength,
    mimeType: "video/mp4",
    storageClass: "CANONICAL_DURABLE",
    sourceExecutionId: "execution-1",
    projectId: "morroway",
    contentId: "content-1",
    createdAt: "2026-10-01T00:00:00.000Z",
    retentionClass: "KEEP_WHILE_REFERENCED",
    bytesValue: bytes,
    ...overrides,
  };
}

test("write, head, read, exists and transport reference verify the canonical hash", async () => {
  const input = request();
  const receipt = await backend.put(input);
  assert.equal(receipt.storageKey, canonicalStorageKey(input));
  assert.equal(receipt.durabilityStatus, "VERIFIED");
  assert.deepEqual(Buffer.from(await backend.get(receipt.storageKey, input.sha256)), Buffer.from(input.bytesValue));
  assert.equal((await backend.head(receipt.storageKey)).durabilityStatus, "VERIFIED");
  assert.equal(await backend.exists(receipt.storageKey), true);
  const ref = await backend.createReadReference(receipt.storageKey, input.sha256);
  assert.equal(ref.type, "LOCAL_TEST_REFERENCE");
  assert.equal(ref.expectedSha256, input.sha256);
});

test("duplicate content put is idempotent and content-addressed", async () => {
  const bytes = Buffer.from("same immutable payload");
  const first = request(bytes, { artifactId: "artifact-first" });
  const second = request(bytes, { artifactId: "artifact-second" });
  const a = await backend.put(first);
  const b = await backend.put(second);
  assert.equal(a.storageKey, b.storageKey);
  assert.equal(a.sha256, b.sha256);
  const leaf = path.dirname(fileURLToPath((await backend.createReadReference(a.storageKey, a.sha256)).reference));
  assert.equal((await readdir(leaf)).filter((name) => !name.endsWith(".metadata.json")).length, 1);
});

test("declared hash mismatch fails before durable promotion", async () => {
  const input = request(Buffer.from("bad hash declaration"), { sha256: "0".repeat(64) });
  await assert.rejects(() => backend.put(input), /STORAGE_HASH_MISMATCH/);
});

test("corruption is detected by head and get", async () => {
  const input = request(Buffer.from("bytes that will be corrupted"));
  const receipt = await backend.put(input);
  const ref = await backend.createReadReference(receipt.storageKey, receipt.sha256);
  await writeFile(fileURLToPath(ref.reference), Buffer.from("corrupt"));
  assert.equal((await backend.head(receipt.storageKey)).durabilityStatus, "CORRUPT");
  await assert.rejects(() => backend.get(receipt.storageKey, receipt.sha256), /STORAGE_CORRUPTION_DETECTED/);
});

test("deletion is fail-closed until every retention and lineage gate passes", async () => {
  const input = request(Buffer.from("guarded deletion payload"));
  const receipt = await backend.put(input);
  const baseGuard = { ownerAuthorized: true, retentionEligible: true, durableCopyVerified: true, lineagePersisted: true, unresolvedRecoveryReferences: 0, immutableEvidence: false, expectedSha256: receipt.sha256 };
  await assert.rejects(() => backend.delete(receipt.storageKey, { ...baseGuard, durableCopyVerified: false }), /STORAGE_DELETE_NOT_AUTHORIZED/);
  assert.equal(await backend.exists(receipt.storageKey), true);
  await backend.delete(receipt.storageKey, baseGuard);
  assert.equal(await backend.exists(receipt.storageKey), false);
});

test("storage keys cannot escape the isolated root", async () => {
  const input = request(Buffer.from("path guard"), { storageKey: "../escape" });
  await assert.rejects(() => backend.put(input), /STORAGE_KEY_INVALID/);
});

test("normal output roots require a different backend and cannot masquerade as the test store", () => {
  assert.throws(() => new LocalDurableObjectStorage({ root: path.resolve("output"), testOnlyAcknowledgement: LOCAL_DURABLE_TEST_ACKNOWLEDGEMENT }), /LOCAL_STORAGE_NORMAL_OUTPUT_ROOT_FORBIDDEN/);
});
