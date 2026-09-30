import { createHash } from "node:crypto";
import type pg from "pg";

export interface ResearchArtifactIntegrityRepairInput {
  readonly repairId: string;
  readonly artifactId: string;
  readonly workflowId: string;
  readonly recoveryExecutionId: string;
  readonly repairKind: "RESEARCH_LINEAGE_AND_GATE_CONSISTENCY_V1" | `TARGETED_VERIFICATION_REVISION:${string}`;
  readonly authorizationRef: string;
  readonly evidenceRef: string;
  readonly expectedPriorPayloadHash: string;
  readonly repairedPayload: Record<string, unknown>;
}

export interface ResearchArtifactIntegrityRepairResult {
  readonly outcome: "APPLIED" | "ALREADY_REPAIRED";
  readonly mutated: boolean;
  readonly repairId: string;
  readonly artifactId: string;
  readonly priorPayloadHash: string;
  readonly repairedPayloadHash: string;
  readonly receipt: Record<string, unknown>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)]));
  }
  return value;
}

export function artifactPayloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Audited, idempotent in-place revision for one completed Research artifact. */
export class ArtifactIntegrityRepairStore {
  constructor(private readonly pool: pg.Pool) {}

  async repairResearchArtifact(input: ResearchArtifactIntegrityRepairInput): Promise<ResearchArtifactIntegrityRepairResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT * FROM artifact_integrity_repairs
         WHERE repair_id=$1 OR (artifact_id=$2 AND repair_kind=$3)
         FOR UPDATE`,
        [input.repairId, input.artifactId, input.repairKind],
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        const exact = row.repair_id === input.repairId
          && row.artifact_id === input.artifactId
          && row.workflow_id === input.workflowId
          && row.recovery_execution_id === input.recoveryExecutionId
          && row.repair_kind === input.repairKind
          && row.prior_payload_hash === input.expectedPriorPayloadHash
          && row.receipt?.authorizationRef === input.authorizationRef
          && row.receipt?.evidenceRef === input.evidenceRef;
        if (!exact) throw new Error("ARTIFACT_INTEGRITY_REPAIR_IDENTITY_CONFLICT");
        await client.query("COMMIT");
        return {
          outcome: "ALREADY_REPAIRED", mutated: false, repairId: input.repairId,
          artifactId: input.artifactId, priorPayloadHash: row.prior_payload_hash,
          repairedPayloadHash: row.repaired_payload_hash, receipt: row.receipt,
        };
      }

      const artifactResult = await client.query(
        `SELECT artifact_id,workflow_id,kind,producer_agent,status,payload
         FROM artifacts WHERE artifact_id=$1 FOR UPDATE`,
        [input.artifactId],
      );
      if (!artifactResult.rowCount) throw new Error("ARTIFACT_INTEGRITY_REPAIR_ARTIFACT_NOT_FOUND");
      const artifact = artifactResult.rows[0];
      if (artifact.workflow_id !== input.workflowId || artifact.kind !== "research_report"
        || artifact.producer_agent !== "research" || artifact.status !== "completed") {
        throw new Error("ARTIFACT_INTEGRITY_REPAIR_SCOPE_MISMATCH");
      }
      const workflow = await client.query(`SELECT state FROM workflow_instances WHERE workflow_id=$1 FOR UPDATE`, [input.workflowId]);
      const step = await client.query(`SELECT status FROM workflow_steps WHERE workflow_id=$1 AND step_id='research' FOR UPDATE`, [input.workflowId]);
      if (!workflow.rowCount || String(workflow.rows[0].state).toUpperCase() !== "PAUSED"
        || !step.rowCount || String(step.rows[0].status).toUpperCase() !== "COMPLETED") {
        throw new Error("ARTIFACT_INTEGRITY_REPAIR_OWNER_REVIEW_STATE_MISMATCH");
      }
      const priorPayload = artifact.payload as Record<string, unknown>;
      const priorPayloadHash = artifactPayloadHash(priorPayload);
      if (priorPayloadHash !== input.expectedPriorPayloadHash) throw new Error("ARTIFACT_INTEGRITY_REPAIR_PRIOR_HASH_MISMATCH");

      const repairedAt = new Date().toISOString();
      const repairedPayloadHash = artifactPayloadHash(input.repairedPayload);
      const receipt = {
        repairId: input.repairId, repairKind: input.repairKind,
        artifactId: input.artifactId, workflowId: input.workflowId,
        recoveryExecutionId: input.recoveryExecutionId,
        authorizationRef: input.authorizationRef, evidenceRef: input.evidenceRef,
        priorPayloadHash, repairedPayloadHash, repairedAt,
        mode: "AUDITED_IN_PLACE_REVISION",
      };
      const previousReceipt = priorPayload.artifactIntegrityRepair;
      const previousHistory = Array.isArray(priorPayload.artifactIntegrityRepairHistory)
        ? priorPayload.artifactIntegrityRepairHistory : [];
      const persistedPayload = {
        ...input.repairedPayload,
        artifactIntegrityRepairHistory: [...previousHistory, ...(previousReceipt === undefined ? [] : [previousReceipt])],
        artifactIntegrityRepair: receipt,
      };
      await client.query(
        `INSERT INTO artifact_integrity_repairs
         (repair_id,artifact_id,workflow_id,recovery_execution_id,repair_kind,prior_payload,repaired_payload,
          prior_payload_hash,repaired_payload_hash,receipt,created_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb,$11)`,
        [input.repairId, input.artifactId, input.workflowId, input.recoveryExecutionId, input.repairKind,
          JSON.stringify(priorPayload), JSON.stringify(persistedPayload), priorPayloadHash,
          repairedPayloadHash, JSON.stringify(receipt), repairedAt],
      );
      await client.query(`UPDATE artifacts SET payload=$2::jsonb WHERE artifact_id=$1`, [input.artifactId, JSON.stringify(persistedPayload)]);
      await client.query("COMMIT");
      return { outcome: "APPLIED", mutated: true, repairId: input.repairId, artifactId: input.artifactId, priorPayloadHash, repairedPayloadHash, receipt };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
