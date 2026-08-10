import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";

export const COMMAND_CAPABILITY_ID = "execution.command";

export interface AllowedCommand {
  command: string;
  args: readonly string[];
}

export interface CommandEnvironmentPolicy {
  inherit: boolean;
  allowedKeys: readonly string[];
  fixedValues?: Readonly<Record<string, string>>;
}

export interface CommandCapabilityPolicy {
  allowedCommands: readonly AllowedCommand[];
  allowedWorkingDirectoryRoots: readonly string[];
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  environment: CommandEnvironmentPolicy;
}

export interface CommandCapabilityInput {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: Readonly<Record<string, string>>;
}

export interface CommandCapabilityOutput {
  command: string;
  args: readonly string[];
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

type CommandRequest = CapabilityRequest<CommandCapabilityInput>;
type CommandResult = CapabilityResult<CommandCapabilityOutput>;

export class CommandCapabilityExecutor
  implements CapabilityExecutorPort<CommandCapabilityInput, CommandCapabilityOutput> {
  private readonly policy: CommandCapabilityPolicy;
  private readonly roots: readonly string[];

  constructor(policy: CommandCapabilityPolicy) {
    if (policy.allowedCommands.length === 0) throw new Error("At least one allowed command is required");
    if (policy.allowedWorkingDirectoryRoots.length === 0) throw new Error("At least one working directory root is required");
    if (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0) throw new Error("timeoutMs must be positive");
    if (!Number.isSafeInteger(policy.maxStdoutBytes) || policy.maxStdoutBytes < 0) throw new Error("maxStdoutBytes must be non-negative");
    if (!Number.isSafeInteger(policy.maxStderrBytes) || policy.maxStderrBytes < 0) throw new Error("maxStderrBytes must be non-negative");
    this.policy = policy;
    this.roots = policy.allowedWorkingDirectoryRoots.map((root) => {
      if (!isAbsolute(root)) throw new Error(`Working directory root must be absolute: ${root}`);
      return resolve(root);
    });
  }

  async execute(request: CommandRequest): Promise<CommandResult> {
    const authorization = await this.authorize(request);
    if (authorization.status === "blocked") return authorization.result;
    const startedAt = Date.now();
    return new Promise((resolveResult) => {
      const { command, args } = request.input;
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let outputLimitExceeded = false;
      let timedOut = false;
      const child = spawn(command, [...args], {
        cwd: authorization.cwd,
        env: this.buildEnvironment(request.input.env),
        shell: false,
        windowsHide: true,
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.policy.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        stdout.push(chunk);
        if (stdoutBytes > this.policy.maxStdoutBytes) {
          outputLimitExceeded = true;
          child.kill();
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        stderr.push(chunk);
        if (stderrBytes > this.policy.maxStderrBytes) {
          outputLimitExceeded = true;
          child.kill();
        }
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        resolveResult(this.failed(request, authorization.cwd, args, "EXECUTION_ERROR", error.message, startedAt, stdout, stderr, null));
      });
      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        const output = this.output(request.input.command, args, authorization.cwd, exitCode, stdout, stderr);
        if (timedOut) {
          resolveResult(this.failed(request, authorization.cwd, args, "TIMEOUT", "Command timed out", startedAt, stdout, stderr, exitCode, output));
        } else if (outputLimitExceeded) {
          resolveResult(this.failed(request, authorization.cwd, args, "OUTPUT_LIMIT_EXCEEDED", "Command output exceeded configured limit", startedAt, stdout, stderr, exitCode, output));
        } else if (exitCode !== 0) {
          resolveResult(this.failed(request, authorization.cwd, args, "NON_ZERO_EXIT", `Command exited with code ${exitCode ?? "unknown"}`, startedAt, stdout, stderr, exitCode, output));
        } else {
          resolveResult(this.succeeded(request, output, startedAt));
        }
      });
    });
  }

  private async authorize(request: CommandRequest): Promise<{ status: "authorized"; cwd: string } | { status: "blocked"; result: CommandResult }> {
    const input = request.input;
    if (request.capabilityId !== COMMAND_CAPABILITY_ID) return { status: "blocked", result: this.blocked(request, "Unsupported capability") };
    if (!this.isSafeToken(input?.command) || this.isForbiddenExecutable(input.command) || !Array.isArray(input?.args) || input.args.some((arg) => !this.isSafeToken(arg))) {
      return { status: "blocked", result: this.blocked(request, "Malformed command or arguments") };
    }
    const allowed = this.policy.allowedCommands.some((rule) => rule.command === input.command && rule.args.length === input.args.length && rule.args.every((arg, index) => arg === input.args[index]));
    if (!allowed) return { status: "blocked", result: this.blocked(request, "Command is not allowlisted") };
    if (typeof input.cwd !== "string" || input.cwd.length === 0 || input.cwd.includes("\0")) {
      return { status: "blocked", result: this.blocked(request, "Malformed working directory") };
    }
    const candidate = resolve(input.cwd);
    const root = this.roots.find((value) => this.isWithin(value, candidate));
    if (!root) return { status: "blocked", result: this.blocked(request, "Working directory is outside allowed roots") };
    try {
      const canonicalRoot = await realpath(root);
      const canonicalCwd = await realpath(candidate);
      if (!this.isWithin(canonicalRoot, canonicalCwd) || !(await stat(canonicalCwd)).isDirectory()) {
        return { status: "blocked", result: this.blocked(request, "Invalid working directory") };
      }
      if (input.env && Object.keys(input.env).some((key) => !this.policy.environment.allowedKeys.includes(key))) {
        return { status: "blocked", result: this.blocked(request, "Environment variable is not allowed") };
      }
      return { status: "authorized", cwd: canonicalCwd };
    } catch {
      return { status: "blocked", result: this.blocked(request, "Invalid working directory") };
    }
  }

  private buildEnvironment(requested?: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    if (this.policy.environment.inherit) {
      for (const key of this.policy.environment.allowedKeys) {
        const value = process.env[key];
        if (value !== undefined) environment[key] = value;
      }
    }
    Object.assign(environment, requested ?? {}, this.policy.environment.fixedValues ?? {});
    return environment;
  }

  private output(command: string, args: readonly string[], cwd: string, exitCode: number | null, stdout: Buffer[], stderr: Buffer[]): CommandCapabilityOutput {
    return { command, args: [...args], cwd, exitCode, stdout: Buffer.concat(stdout).subarray(0, this.policy.maxStdoutBytes).toString("utf8"), stderr: Buffer.concat(stderr).subarray(0, this.policy.maxStderrBytes).toString("utf8") };
  }

  private succeeded(request: CommandRequest, output: CommandCapabilityOutput, startedAt: number): CommandResult {
    return { status: "success", resultId: this.resultId(request), capabilityId: request.capabilityId, output, evidence: this.evidence(request, output, true, startedAt) };
  }

  private failed(request: CommandRequest, cwd: string, args: readonly string[], code: string, message: string, startedAt: number, stdout: Buffer[], stderr: Buffer[], exitCode: number | null, output = this.output(request.input.command, args, cwd, exitCode, stdout, stderr)): CommandResult {
    return { status: "failed", resultId: this.resultId(request), capabilityId: request.capabilityId, error: { code, message, retryable: false }, evidence: this.evidence(request, output, false, startedAt, { code, message }) };
  }

  private evidence(request: CommandRequest, output: CommandCapabilityOutput, succeeded: boolean, startedAt: number, error?: { code: string; message: string }): ExecutionEvidence {
    return { evidenceId: `evidence-${this.resultId(request)}`, capabilityId: request.capabilityId, command: output.command, arguments: output.args, workingDirectory: output.cwd, exitCode: output.exitCode ?? undefined, stdout: output.stdout, stderr: output.stderr, workflowId: request.workflowId, correlationId: request.correlationId, agentId: request.agentId, executedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - startedAt), succeeded, resultStatus: succeeded ? "success" : "failed", ...(error === undefined ? {} : { error }) };
  }

  private blocked(request: CommandRequest, reason: string): CommandResult { return { status: "blocked", resultId: this.resultId(request), capabilityId: request.capabilityId, reason }; }
  private resultId(request: CommandRequest): string { return `command-result-${request.requestId}`; }
  private isSafeToken(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !/[;&|<>$`()\r\n]/u.test(value); }
  private isForbiddenExecutable(command: string): boolean {
    return new Set(["bash", "sh", "zsh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]).has(basename(command).toLowerCase());
  }
  private isWithin(root: string, candidate: string): boolean { const value = relative(root, candidate); const first = value.split(sep)[0]; return value === "" || (first !== ".." && !isAbsolute(value)); }
}
