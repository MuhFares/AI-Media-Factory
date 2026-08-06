/**
 * Default Scheduler implementation.
 */

import type { StepId, WorkflowInstance } from "../core/instance.js";
import type { Step } from "../model/step.js";
import type { Scheduler } from "../execution/scheduler.js";

export class DefaultScheduler implements Scheduler {
  readySteps(instance: WorkflowInstance): StepId[] {
    const { steps, ready } = instance;
    // Return steps that are ready to run (in ready array and not completed/running)
    return ready.filter((stepId) => {
      const stepRecord = steps.find((s) => s.stepId === stepId);
      return stepRecord && (stepRecord.status === "pending" || stepRecord.status === "failed");
    });
  }

  isJoinReady(instance: WorkflowInstance, joinStep: StepId): boolean {
    // Find the parallel step that joins to this step
    const parallelStep = instance.steps.find(
      (s) => s.stepId === joinStep
    );
    if (!parallelStep) return false;

    // Check if all branches of the parallel step have completed
    const parallelDef = this.findParallelStep(instance, joinStep);
    if (!parallelDef) return true;

    return parallelDef.branches.every((branchId) => {
      const branchRecord = instance.steps.find((s) => s.stepId === branchId);
      return branchRecord?.status === "completed";
    });
  }

  advance(instance: WorkflowInstance, completed: StepId): StepId[] {
    // Get the step definition
    const stepDef = this.getStepDefinition(instance, completed);
    if (!stepDef) return [];

    const nextSteps: StepId[] = [];

    if (stepDef.kind === "parallel") {
      // For parallel, all branches are ready
      nextSteps.push(...stepDef.branches);
    } else if (stepDef.kind === "branch") {
      // For branch, the next step is determined by the router
      // We return empty here; the router will determine the actual next step
    } else if (stepDef.next) {
      // Sequential: single next step or multiple
      const next = Array.isArray(stepDef.next) ? stepDef.next : [stepDef.next];
      nextSteps.push(...next);
    }

    return nextSteps;
  }

  private findParallelStep(instance: WorkflowInstance, joinStep: StepId): { branches: StepId[] } | null {
    // This would need the workflow definition to find the parallel step
    // For now, return null
    return null;
  }

  private getStepDefinition(instance: WorkflowInstance, stepId: StepId): Step | null {
    // This would need access to the workflow definition
    // For now, return null
    return null;
  }
}