/**
 * Default TimeoutController implementation.
 */

import type { StepId, Uuid, TimeoutController } from "../resilience/timeout.js";

export class DefaultTimeoutController implements TimeoutController {
  stepDeadline(stepId: StepId, seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }

  workflowDeadline(workflowId: Uuid, seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }

  isExpired(deadline: Date): boolean {
    return Date.now() >= deadline.getTime();
  }
}