import { describe, it, beforeEach, afterEach } from "node:test";
import { deepStrictEqual, strictEqual, ok } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { FilesystemCapabilityExecutor } from "../dist/index.js";

describe("FilesystemCapabilityExecutor", () => {
  let root;
  let otherRoot;
  let executor;
  let sequence;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "amf-filesystem-"));
    otherRoot = await mkdtemp(join(tmpdir(), "amf-filesystem-other-"));
    executor = new FilesystemCapabilityExecutor({
      allowedRoots: [root, otherRoot],
      allowedOperations: ["read", "write", "create", "modify", "delete"],
      maxFileSizeBytes: 32,
    });
    sequence = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  });

  function request(operation, path, content) {
    sequence += 1;
    return {
      requestId: `request-${sequence}`,
      capabilityId: "filesystem",
      agentId: "coding",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      input: { operation, path, ...(content === undefined ? {} : { content }) },
      requestedAt: new Date().toISOString(),
    };
  }

  it("supports read, create, write, modify, and delete", async () => {
    const created = await executor.execute(request("create", "file.txt", "one"));
    strictEqual(created.status, "success");
    const read = await executor.execute(request("read", "file.txt"));
    strictEqual(read.status, "success");
    strictEqual(read.output.content, "one");
    const written = await executor.execute(request("write", "file.txt", "two"));
    strictEqual(written.status, "success");
    const modified = await executor.execute(request("modify", "file.txt", "three"));
    strictEqual(modified.status, "success");
    const deleted = await executor.execute(request("delete", "file.txt"));
    strictEqual(deleted.status, "success");
    strictEqual((await stat(join(root, "file.txt")).catch(() => null)), null);
  });

  it("returns FAILED for missing files and existing create targets", async () => {
    const missing = await executor.execute(request("read", "missing.txt"));
    strictEqual(missing.status, "failed");
    strictEqual(missing.error.code, "MISSING_FILE");
    await executor.execute(request("create", "existing.txt", "one"));
    const existing = await executor.execute(request("create", "existing.txt", "two"));
    strictEqual(existing.status, "failed");
  });

  it("blocks unauthorized operations and malformed paths without side effects", async () => {
    const restricted = new FilesystemCapabilityExecutor({ allowedRoots: [root], allowedOperations: ["read"], maxFileSizeBytes: 32 });
    const before = await readFile(join(root, "missing.txt")).catch(() => null);
    const blocked = await restricted.execute(request("write", "blocked.txt", "no"));
    strictEqual(blocked.status, "blocked");
    strictEqual(await readFile(join(root, "blocked.txt")).catch(() => null), before);
    strictEqual((await restricted.execute(request("read", ""))).status, "blocked");
    strictEqual((await restricted.execute(request("read", "bad\0path"))).status, "blocked");
  });

  it("blocks traversal, nested traversal, and outside absolute paths", async () => {
    strictEqual((await executor.execute(request("create", "../escape.txt", "x"))).status, "blocked");
    strictEqual((await executor.execute(request("create", "nested/../../escape.txt", "x"))).status, "blocked");
    strictEqual((await executor.execute(request("create", resolve(root, "..", "outside.txt"), "x"))).status, "blocked");
  });

  it("supports multiple allowed roots", async () => {
    const result = await executor.execute(request("create", join(otherRoot, "second.txt"), "two"));
    strictEqual(result.status, "success");
    strictEqual(await readFile(join(otherRoot, "second.txt"), "utf8"), "two");
  });

  it("enforces the maximum file size", async () => {
    const result = await executor.execute(request("create", "large.txt", "123456789012345678901234567890123"));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "FILE_TOO_LARGE");
  });

  it("returns truthful evidence with workflow, correlation, and agent identity", async () => {
    const success = await executor.execute(request("create", "evidence.txt", "ok"));
    strictEqual(success.status, "success");
    strictEqual(success.evidence.operation, "create");
    strictEqual(success.evidence.workflowId, "workflow-1");
    strictEqual(success.evidence.correlationId, "correlation-1");
    strictEqual(success.evidence.agentId, "coding");
    strictEqual(success.evidence.succeeded, true);
    const failure = await executor.execute(request("read", "missing-evidence.txt"));
    strictEqual(failure.status, "failed");
    strictEqual(failure.evidence.succeeded, false);
    strictEqual(failure.evidence.error.code, "MISSING_FILE");
  });
});
