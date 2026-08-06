/**
 * Default CompensationRunner implementation.
 */

import type { StepId } from "../core/common.js";
import type { WorkflowInstance } from "../core/instance.js";
import type { CompensationPlan, CompensationRunner } from "../execution/compensation.js";
import type { Step } from "../model/step.js";

export class DefaultCompensationRunner implements CompensationRunner {
  constructor(
    private readonly getStepDefinition: (stepId: StepId) => Step | null,
    private readonly executeCompensation: (stepId: StepId) => Promise<void>
  ) {}

  plan(instance: WorkflowInstance): CompensationPlan {
    // Get completed steps that have compensation, in reverse order
    const completedWithCompensation = instance.steps
      .filter((s) => s.status === "completed")
      .reverse()
      .map((s) => s.stepId)
      .filter((stepId) => {
        const stepDef = this.getStepDefinition(stepId);
        return stepDef?.compensatedBy !== undefined;
      });

    return { steps: completedWithCompensation };
  }

  async compensate(instance: WorkflowInstance, stepId: StepId): Promise<void> {
    const stepDef = this.getStepDefinition(stepId);
    if (!stepDef || !stepDef.compensatedBy) {
      throw new Error(`No compensation defined for step ${stepId}`);
    }

    await this.executeCompensation(stepDef.compensatedBy);

    // Mark the original step as compensated
    const stepRecord = instance.steps.find((s) => s.stepId === stepId);
    if (stepRecord) {
      stepRecord.status = "compensated";
    }
  }
}