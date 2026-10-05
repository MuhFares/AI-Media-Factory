/** Zero-network classification of the process that would own live media I/O. */
export interface WorkerExecutionEnvironment {
  readonly status: "SUPPORTED" | "UNSUPPORTED";
  readonly mediaLiveExecutionAllowed: boolean;
  readonly reasonCode: string | null;
  readonly reasonCodes: readonly string[];
  readonly failedCheckNames: readonly string[];
  readonly passedCheckNames: readonly string[];
  readonly runtimeFingerprint: {
    readonly platform: string;
    readonly arch: string;
    readonly nodeMajor: number;
  };
}

function enabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function inspectWorkerExecutionEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerExecutionEnvironment {
  const runtimeFingerprint = {
    platform: process.platform,
    arch: process.arch,
    nodeMajor: Number(process.versions.node.split(".")[0]),
  };
  // Codex supplies this explicit marker to child processes whose outbound
  // network is denied. Such a process must never own live provider execution.
  if (enabled(env.CODEX_SANDBOX_NETWORK_DISABLED)) {
    return {
      status: "UNSUPPORTED",
      mediaLiveExecutionAllowed: false,
      reasonCode: "ENGINEERING_SANDBOX_NETWORK_DISABLED",
      reasonCodes: ["ENGINEERING_SANDBOX_NETWORK_DISABLED"],
      failedCheckNames: ["ENGINEERING_SANDBOX_NETWORK_POLICY"],
      passedCheckNames: [],
      runtimeFingerprint,
    };
  }
  return {
    status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null,
    reasonCodes: [], failedCheckNames: [],
    passedCheckNames: ["ENGINEERING_SANDBOX_NETWORK_POLICY"],
    runtimeFingerprint,
  };
}
