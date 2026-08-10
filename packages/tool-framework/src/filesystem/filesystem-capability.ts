import { access, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";

export const FILESYSTEM_CAPABILITY_ID = "filesystem";
export type FilesystemOperation = "read" | "write" | "create" | "modify" | "delete";

export interface FilesystemCapabilityInput {
  operation: FilesystemOperation;
  path: string;
  content?: string;
}

export interface FilesystemCapabilityOutput {
  operation: FilesystemOperation;
  requestedPath: string;
  resolvedPath: string;
  content?: string;
  bytes?: number;
}

export interface FilesystemCapabilityPolicy {
  allowedRoots: readonly string[];
  allowedOperations: readonly FilesystemOperation[];
  maxFileSizeBytes: number;
}

type FilesystemRequest = CapabilityRequest<FilesystemCapabilityInput>;
type FilesystemResult = CapabilityResult<FilesystemCapabilityOutput>;

interface AuthorizedPath {
  requestedPath: string;
  candidatePath: string;
  root: string;
}

export class FilesystemCapabilityExecutor
  implements CapabilityExecutorPort<FilesystemCapabilityInput, FilesystemCapabilityOutput> {
  private readonly policy: FilesystemCapabilityPolicy;
  private readonly roots: readonly string[];

  constructor(policy: FilesystemCapabilityPolicy) {
    if (policy.allowedRoots.length === 0) throw new Error("At least one allowed filesystem root is required");
    if (!Number.isSafeInteger(policy.maxFileSizeBytes) || policy.maxFileSizeBytes < 0) {
      throw new Error("maxFileSizeBytes must be a non-negative safe integer");
    }
    this.policy = {
      allowedRoots: policy.allowedRoots,
      allowedOperations: [...policy.allowedOperations],
      maxFileSizeBytes: policy.maxFileSizeBytes,
    };
    this.roots = policy.allowedRoots.map((root) => {
      if (!isAbsolute(root)) throw new Error(`Allowed root must be absolute: ${root}`);
      return resolve(root);
    });
  }

  async execute(request: FilesystemRequest): Promise<FilesystemResult> {
    const authorization = this.authorize(request);
    if (authorization.status === "blocked") return authorization.result;
    const startedAt = Date.now();
    try {
      const output = await this.perform(request, authorization.path);
      return this.success(request, authorization.path, output, startedAt);
    } catch (error) {
      return this.failure(request, authorization.path, error, startedAt);
    }
  }

  private authorize(request: FilesystemRequest):
    | { status: "authorized"; path: AuthorizedPath }
    | { status: "blocked"; result: FilesystemResult } {
    const input = request.input;
    if (request.capabilityId !== FILESYSTEM_CAPABILITY_ID) return { status: "blocked", result: this.blocked(request, "Unsupported capability") };
    if (!this.policy.allowedOperations.includes(input?.operation)) return { status: "blocked", result: this.blocked(request, "Operation is not allowed") };
    if (typeof input?.path !== "string" || input.path.length === 0 || input.path.includes("\0")) {
      return { status: "blocked", result: this.blocked(request, "Malformed filesystem path") };
    }
    if ((input.operation === "write" || input.operation === "create" || input.operation === "modify") && typeof input.content !== "string") {
      return { status: "blocked", result: this.blocked(request, "Content is required for this operation") };
    }

    const requestedPath = input.path;
    const candidates = this.roots.map((root) => ({
      candidatePath: isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(root, requestedPath),
      root,
    }));
    const match = candidates.find(({ candidatePath, root }) => this.isWithin(root, candidatePath));
    if (!match) return { status: "blocked", result: this.blocked(request, "Path is outside allowed roots") };
    return { status: "authorized", path: { requestedPath, ...match } };
  }

  private async perform(request: FilesystemRequest, authorized: AuthorizedPath): Promise<FilesystemCapabilityOutput> {
    const { operation, content } = request.input;
    const resolvedPath = await this.resolveCanonicalPath(authorized);
    if ((operation === "read" || operation === "write" || operation === "modify" || operation === "delete") && !(await this.exists(resolvedPath))) {
      throw new FilesystemError("MISSING_FILE", "File does not exist", false);
    }
    if (operation === "read") {
      const file = await stat(resolvedPath);
      this.ensureSize(file.size);
      const value = await readFile(resolvedPath, "utf8");
      return { operation, requestedPath: authorized.requestedPath, resolvedPath, content: value, bytes: Buffer.byteLength(value) };
    }
    if (operation === "delete") {
      await unlink(resolvedPath);
      return { operation, requestedPath: authorized.requestedPath, resolvedPath };
    }

    const value = content ?? "";
    this.ensureSize(Buffer.byteLength(value));
    await writeFile(resolvedPath, value, { encoding: "utf8", flag: operation === "create" ? "wx" : "w" });
    return { operation, requestedPath: authorized.requestedPath, resolvedPath, bytes: Buffer.byteLength(value) };
  }

  private async resolveCanonicalPath(authorized: AuthorizedPath): Promise<string> {
    const canonicalRoot = await realpath(authorized.root);
    try {
      const canonical = await realpath(authorized.candidatePath);
      if (!this.isWithin(canonicalRoot, canonical)) throw new FilesystemError("PATH_ESCAPE", "Resolved path is outside allowed root", false);
      return canonical;
    } catch (error) {
      if (error instanceof FilesystemError) throw error;
      const parent = await realpath(dirname(authorized.candidatePath));
      if (!this.isWithin(canonicalRoot, parent)) throw new FilesystemError("PATH_ESCAPE", "Resolved parent is outside allowed root", false);
      return join(parent, authorized.candidatePath.slice(dirname(authorized.candidatePath).length + 1));
    }
  }

  private async exists(path: string): Promise<boolean> {
    try { await access(path, constants.F_OK); return true; } catch { return false; }
  }

  private ensureSize(bytes: number): void {
    if (bytes > this.policy.maxFileSizeBytes) throw new FilesystemError("FILE_TOO_LARGE", "File exceeds configured size limit", false);
  }

  private isWithin(root: string, candidate: string): boolean {
    const value = relative(root, candidate);
    const firstSegment = value.split(sep)[0];
    return value === "" || (firstSegment !== ".." && !isAbsolute(value));
  }

  private blocked(request: FilesystemRequest, reason: string): FilesystemResult {
    return { status: "blocked", resultId: this.resultId(request), capabilityId: request.capabilityId, reason };
  }

  private success(request: FilesystemRequest, path: AuthorizedPath, output: FilesystemCapabilityOutput, startedAt: number): FilesystemResult {
    return { status: "success", resultId: this.resultId(request), capabilityId: request.capabilityId, output, evidence: this.evidence(request, path, output.resolvedPath, true, startedAt) };
  }

  private failure(request: FilesystemRequest, path: AuthorizedPath, error: unknown, startedAt: number): FilesystemResult {
    const failure = error instanceof FilesystemError ? error : new FilesystemError("IO_ERROR", error instanceof Error ? error.message : "Filesystem operation failed", false);
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code: failure.code, message: failure.message, retryable: failure.retryable },
      evidence: this.evidence(request, path, path.candidatePath, false, startedAt, { code: failure.code, message: failure.message }),
    };
  }

  private evidence(request: FilesystemRequest, path: AuthorizedPath, resolvedPath: string, succeeded: boolean, startedAt: number, error?: { code: string; message: string }): ExecutionEvidence {
    return { evidenceId: `evidence-${this.resultId(request)}`, capabilityId: request.capabilityId, operation: request.input.operation, requestedPath: path.requestedPath, resolvedPath, workflowId: request.workflowId, correlationId: request.correlationId, agentId: request.agentId, executedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - startedAt), succeeded, ...(error === undefined ? {} : { error }) };
  }

  private resultId(request: FilesystemRequest): string { return `filesystem-result-${request.requestId}`; }
}

class FilesystemError extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean) { super(message); }
}
