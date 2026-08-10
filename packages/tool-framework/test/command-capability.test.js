import { describe, it, beforeEach, afterEach } from "node:test";
import { strictEqual, ok } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execPath } from "node:process";
import { CommandCapabilityExecutor } from "../dist/index.js";

describe("CommandCapabilityExecutor", () => {
  let root;
  let sequence;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "amf-command-"));
    sequence = 0;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function request(args, cwd = root, env) {
    sequence += 1;
    return {
      requestId: `command-${sequence}`,
      capabilityId: "execution.command",
      agentId: "qa",
      workflowId: "workflow-command",
      correlationId: "correlation-command",
      input: { command: execPath, args, cwd, ...(env === undefined ? {} : { env }) },
      requestedAt: new Date().toISOString(),
    };
  }

  function executor(args, options = {}) {
    return new CommandCapabilityExecutor({
      allowedCommands: [{ command: execPath, args }],
      allowedWorkingDirectoryRoots: [root],
      timeoutMs: options.timeoutMs ?? 1000,
      maxStdoutBytes: options.maxStdoutBytes ?? 1024,
      maxStderrBytes: options.maxStderrBytes ?? 1024,
      environment: { inherit: false, allowedKeys: ["TEST_ALLOWED"], fixedValues: { PATH: process.env.PATH ?? "" } },
    });
  }

  async function script(name, content) {
    await writeFile(join(root, name), content, "utf8");
    return name;
  }

  it("executes an allowlisted command and captures exit code/evidence", async () => {
    const file = await script("ok.mjs", "process.stdout.write('hello');");
    const result = await executor([file]).execute(request([file]));
    strictEqual(result.status, "success");
    strictEqual(result.output.stdout, "hello");
    strictEqual(result.output.exitCode, 0);
    strictEqual(result.evidence.command, execPath);
    strictEqual(result.evidence.arguments[0], file);
    strictEqual(result.evidence.workflowId, "workflow-command");
    strictEqual(result.evidence.correlationId, "correlation-command");
    strictEqual(result.evidence.agentId, "qa");
    strictEqual(result.evidence.succeeded, true);
  });

  it("returns FAILED for a non-zero exit", async () => {
    const file = await script("fail.mjs", "process.stderr.write('bad'); process.exit(3);");
    const result = await executor([file]).execute(request([file]));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "NON_ZERO_EXIT");
    strictEqual(result.evidence.exitCode, 3);
    strictEqual(result.evidence.succeeded, false);
    strictEqual(result.evidence.error.code, "NON_ZERO_EXIT");
  });

  it("blocks non-allowlisted commands and shell metacharacters", async () => {
    const allowed = executor(["ok.mjs"]);
    strictEqual((await allowed.execute(request(["other.mjs"]))).status, "blocked");
    strictEqual((await allowed.execute({ ...request(["ok.mjs"]), input: { command: execPath, args: ["ok.mjs", "&&", "bad"], cwd: root } })).status, "blocked");
    strictEqual((await allowed.execute({ ...request(["ok.mjs"]), input: { command: `${execPath} && bad`, args: ["ok.mjs"], cwd: root } })).status, "blocked");
  });

  it("blocks traversal and outside working directories before execution", async () => {
    const allowed = executor(["ok.mjs"]);
    strictEqual((await allowed.execute(request(["ok.mjs"], join(root, "..")))).status, "blocked");
    strictEqual((await allowed.execute(request(["ok.mjs"], join(root, "nested", "..", "..")))).status, "blocked");
    strictEqual((await allowed.execute(request(["ok.mjs"], tmpdir()))).status, "blocked");
  });

  it("enforces timeout", async () => {
    const file = await script("slow.mjs", "setTimeout(() => {}, 5000);");
    const result = await executor([file], { timeoutMs: 50 }).execute(request([file]));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "TIMEOUT");
  });

  it("enforces stdout and stderr limits", async () => {
    const outFile = await script("out.mjs", "process.stdout.write('123456789');");
    const out = await executor([outFile], { maxStdoutBytes: 4 }).execute(request([outFile]));
    strictEqual(out.status, "failed");
    strictEqual(out.error.code, "OUTPUT_LIMIT_EXCEEDED");
    const errFile = await script("err.mjs", "process.stderr.write('123456789');");
    const err = await executor([errFile], { maxStderrBytes: 4 }).execute(request([errFile]));
    strictEqual(err.status, "failed");
    strictEqual(err.error.code, "OUTPUT_LIMIT_EXCEEDED");
  });

  it("enforces the environment-variable policy", async () => {
    const file = await script("env.mjs", "process.stdout.write(process.env.TEST_ALLOWED || 'missing');");
    const allowed = executor([file]);
    const result = await allowed.execute(request([file], root, { TEST_ALLOWED: "allowed" }));
    strictEqual(result.status, "success");
    strictEqual(result.output.stdout, "allowed");
    const blocked = await allowed.execute(request([file], root, { NOT_ALLOWED: "no" }));
    strictEqual(blocked.status, "blocked");
  });
});
