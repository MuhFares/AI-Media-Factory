/**
 * Workflow Builder - fluent API for creating workflow definitions.
 */

import type { WorkflowDefinition, WorkflowTrigger, CompensationPolicy } from "../model/definition.js";
import type { Step, AgentStep, BranchStep, ParallelStep, GateStep, CompensationStep, StepId } from "../model/step.js";
import type { Json } from "../core/common.js";

export class WorkflowBuilder {
  private definition: Partial<WorkflowDefinition> = {
    steps: [],
    compensation: { onFailure: true, onCancel: true },
  };

  id(id: string): this {
    this.definition.id = id;
    return this;
  }

  version(version: number): this {
    this.definition.version = version;
    return this;
  }

  trigger(kind: "event" | "schedule" | "manual", spec: string): this {
    this.definition.trigger = { kind, spec };
    return this;
  }

  entryStep(stepId: StepId): this {
    this.definition.entryStep = stepId;
    return this;
  }

  timeoutSeconds(seconds: number): this {
    this.definition.timeoutSeconds = seconds;
    return this;
  }

  compensation(policy: Partial<CompensationPolicy>): this {
    this.definition.compensation = { ...this.definition.compensation!, ...policy };
    return this;
  }

  addAgentStep(step: Omit<AgentStep, "kind">): this {
    this.definition.steps!.push({ ...step, kind: "agent" });
    return this;
  }

  addBranchStep(step: Omit<BranchStep, "kind">): this {
    this.definition.steps!.push({ ...step, kind: "branch" });
    return this;
  }

  addParallelStep(step: Omit<ParallelStep, "kind">): this {
    this.definition.steps!.push({ ...step, kind: "parallel" });
    return this;
  }

  addGateStep(step: Omit<GateStep, "kind">): this {
    this.definition.steps!.push({ ...step, kind: "gate" });
    return this;
  }

  addCompensationStep(step: Omit<CompensationStep, "kind">): this {
    this.definition.steps!.push({ ...step, kind: "compensation" });
    return this;
  }

  build(): WorkflowDefinition {
    if (!this.definition.id) throw new Error("Workflow id is required");
    if (!this.definition.version) throw new Error("Workflow version is required");
    if (!this.definition.trigger) throw new Error("Workflow trigger is required");
    if (!this.definition.entryStep) throw new Error("Workflow entryStep is required");
    if (!this.definition.steps || this.definition.steps.length === 0) {
      throw new Error("Workflow must have at least one step");
    }

    return this.definition as WorkflowDefinition;
  }
}

export function workflow(): WorkflowBuilder {
  return new WorkflowBuilder();
}