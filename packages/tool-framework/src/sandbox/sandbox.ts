/**
 * Tool Sandbox (Req #10).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export type SandboxLevel = "none" | "process" | "container" | "vm" | "wasm";

export interface SandboxConfig {
  level: SandboxLevel;
  memoryLimitMb?: number;
  cpuTimeLimitSec?: number;
  networkAccess: boolean;
  allowedHosts?: string[];
  filesystemAccess: "none" | "read" | "readwrite" | "temp_only";
  allowedPaths?: string[];
  envVars?: Record<string, string>;
  resourceLimits?: ResourceLimits;
}

export interface ResourceLimits {
  maxProcesses?: number;
  maxFileDescriptors?: number;
  maxMemoryMb?: number;
  cpuQuotaPercent?: number;
}

export interface SandboxHandle {
  sandboxId: string;
  processId?: number;
  containerId?: string;
  cleanup: () => Promise<void>;
}

export interface ToolSandbox {
  prepare(config: SandboxConfig): Promise<SandboxHandle>;
  execute<T>(handle: SandboxHandle, fn: () => Promise<T>): Promise<T>;
  cleanup(handle: SandboxHandle): Promise<void>;
}

export interface SandboxInfo {
  sandboxId: string;
  level: string;
  memoryUsedMb?: number;
  cpuTimeMs?: number;
}

export const SANDBOX_LEVELS: Record<string, { isolation: string; overhead: string }> = {
  none: { isolation: "none", overhead: "none" },
  process: { isolation: "process namespace", overhead: "low" },
  container: { isolation: "container namespace + cgroups", overhead: "medium" },
  vm: { isolation: "full virtualization", overhead: "high" },
  wasm: { isolation: "WASM sandbox", overhead: "low" },
};