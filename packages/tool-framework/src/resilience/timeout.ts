/**
 * Tool Timeout Controller (Req #9).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface TimeoutController {
  withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  getRemainingTime(invocationId: string): number;
  setDeadline(invocationId: string, deadline: Date): void;
  clearDeadline(invocationId: string): void;
}

export interface TimeoutConfig {
  defaultStepTimeoutMs: number;
  defaultWorkflowTimeoutMs: number;
  maxTimeoutMs: number;
  warningThresholdPercent: number; // e.g., 0.8 = warn at 80% of timeout
}

export interface TimeoutState {
  deadline: Date;
  warningSent: boolean;
}

export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  defaultStepTimeoutMs: 60000,
  defaultWorkflowTimeoutMs: 300000,
  maxTimeoutMs: 3600000,
  warningThresholdPercent: 0.8,
};