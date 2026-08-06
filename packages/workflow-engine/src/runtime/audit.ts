/**
 * Default AuditTrail implementation.
 */

import type { Json, StepId, Timestamp, Uuid } from "../core/common.js";
import type { AuditEntry, AuditTrail } from "../observability/audit.js";

export class DefaultAuditTrail implements AuditTrail {
  private entries = new Map<Uuid, AuditEntry[]>();

  async append(entry: AuditEntry): Promise<void> {
    const workflowEntries = this.entries.get(entry.workflowId) ?? [];
    workflowEntries.push(entry);
    this.entries.set(entry.workflowId, workflowEntries);
  }

  async history(workflowId: Uuid): Promise<AuditEntry[]> {
    return this.entries.get(workflowId) ?? [];
  }
}