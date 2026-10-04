import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import {
  LocalDurableObjectStorage,
  LOCAL_DURABLE_TEST_ACKNOWLEDGEMENT,
  resolveDurablePublicationTransport,
} from "../dist/index.js";

let root;
let storage;
before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "amf-publication-storage-test-"));
  storage = new LocalDurableObjectStorage({ root, testOnlyAcknowledgement: LOCAL_DURABLE_TEST_ACKNOWLEDGEMENT });
});
after(async () => { await rm(root, { recursive: true, force: true }); });

async function durableMedia() {
  const bytesValue = Buffer.from("publishable durable media");
  const sha256 = createHash("sha256").update(bytesValue).digest("hex");
  const request = { artifactId: "final-media-1", sha256, bytes: bytesValue.length, mimeType: "video/mp4", storageClass: "PUBLISHED_MEDIA", sourceExecutionId: "compose-1", projectId: "morroway", contentId: "content-1", createdAt: "2026-10-01T00:00:00.000Z", retentionClass: "KEEP_7_YEARS", bytesValue };
  return { request, receipt: await storage.put(request) };
}

test("publication transport resolves from durable artifact identity and verified storage receipt", async () => {
  const { request, receipt } = await durableMedia();
  const ref = await resolveDurablePublicationTransport({ artifactId: request.artifactId, sha256: request.sha256, byteCount: request.bytes, mimeType: request.mimeType, storageReceipt: receipt }, storage);
  assert.equal(ref.type, "LOCAL_FILE");
  assert.equal(ref.expectedSha256, request.sha256);
  assert.equal(ref.expectedByteCount, request.bytes);
});

test("publication fails closed on artifact/receipt mismatch", async () => {
  const { request, receipt } = await durableMedia();
  await assert.rejects(() => resolveDurablePublicationTransport({ artifactId: "other", sha256: request.sha256, byteCount: request.bytes, mimeType: request.mimeType, storageReceipt: receipt }, storage), /PUBLICATION_STORAGE_IDENTITY_MISMATCH/);
});

test("publication detects corruption before returning a transport", async () => {
  const { request, receipt } = await durableMedia();
  const ref = await storage.createReadReference(receipt.storageKey, receipt.sha256);
  await writeFile(fileURLToPath(ref.reference), Buffer.from("corrupt"));
  await assert.rejects(() => resolveDurablePublicationTransport({ artifactId: request.artifactId, sha256: request.sha256, byteCount: request.bytes, mimeType: request.mimeType, storageReceipt: receipt }, storage), /PUBLICATION_STORAGE_HEAD_MISMATCH/);
});
