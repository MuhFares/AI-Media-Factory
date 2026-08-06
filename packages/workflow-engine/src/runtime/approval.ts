/**
 * Default ApprovalCoordinator implementation.
 */

import type { Timestamp, Uuid } from "../core/common.js";
import type { ApprovalDecision, ApprovalCoordinator } from "../execution/approval.js";

interface PendingApproval {
  resolve: (value: ApprovalDecision) => void;
  reject: (error: Error) => void;
}

export class DefaultApprovalCoordinator implements ApprovalCoordinator {
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor(
    private readonly emitEvent: (type: string, workflowId: Uuid, payload: any) => Promise<void>
  ) {}

  async request(workflowId: Uuid, stepId: string, approver: string, reason: string): Promise<void> {
    await this.emitEvent("ApprovalRequested", workflowId, { stepId, approver, reason });

    // The actual waiting is done by the caller via signalApproval
    // This just registers the request
  }

  async apply(decision: ApprovalDecision): Promise<void> {
    const key = `${decision.workflowId}:${decision.stepId}`;
    const pending = this.pendingApprovals.get(key);

    if (!pending) {
      // If no one is waiting, just emit the event
      await this.emitEvent("ApprovalDecided", decision.workflowId, decision);
      return;
    }

    this.pendingApprovals.delete(key);

    if (decision.outcome === "approved") {
      await this.emitEvent("ApprovalDecided", decision.workflowId, decision);
      pending.resolve(decision);
    } else {
      await this.emitEvent("ApprovalDecided", decision.workflowId, decision);
      pending.reject(new Error(`Approval rejected: ${decision.note ?? "no reason"}`));
    }
  }

  /** Register a waiter for an approval decision. */
  waitForApproval(workflowId: Uuid, stepId: string): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      this.pendingApprovals.set(`${workflowId}:${stepId}`, { resolve, reject });
    });
  }
}