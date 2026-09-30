/** Zero-network classification of the process that would own live media I/O. */
export interface WorkerExecutionEnvironment {
  readonly status: "SUPPORTED" | "UNSUPPORTED";
  readonly mediaLiveExecutionAllowed: boolean;
  readonly reasonCode: string | null;
}

function enabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  return !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function inspectWorkerExecutionEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WorkerExecutionEnvironment {
  // Codex supplies this explicit marker to child processes whose outbound
  // network is denied. Such a process must never own live provider execution.
  if (enabled(env.CODEX_SANDBOX_NETWORK_DISABLED)) {
    return {
      status: "UNSUPPORTED",
      mediaLiveExecutionAllowed: false,
      reasonCode: "ENGINEERING_SANDBOX_NETWORK_DISABLED",
    };
  }
  return { status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null };
}
