import { randomUUID } from "node:crypto";
import type pg from "pg";

export type ProductionCallKind = "research" | "text_agent";
export interface ProductionCallReservation {
  reservationId:string; idempotencyKey:string; projectId:string; workflowId:string;
  phase:string; stage:string; role:string; callKind:ProductionCallKind; status:string;
}

export interface ProductionCallRepairResult {
  readonly outcome:"APPLIED"|"ALREADY_REPAIRED";
  readonly decremented:boolean;
  readonly repairId:string;
  readonly reservationId:string;
}

export interface TransportOvercountRepairInput {
  readonly reservationId:string;
  readonly idempotencyKey:string;
  readonly workflowId:string;
  readonly stepId:string;
  readonly callLeg:"DIRECTION"|"FINAL_SYNTHESIS"|"RETRIEVAL";
  readonly expectedStatus:"CONSUMED"|"FAILED_AFTER_SUBMISSION";
  readonly repairId:string;
  readonly authorizationRef:string;
  readonly evidenceRef:string;
  readonly reason:string;
}

function repairCallLeg(row:{role:unknown;call_kind:unknown;idempotency_key:unknown}):"DIRECTION"|"FINAL_SYNTHESIS"|"RETRIEVAL"|null{
  if(row.role!=="research"||typeof row.idempotency_key!=="string")return null;
  if(row.call_kind==="research"&&/:retrieval:\d+$/.test(row.idempotency_key))return "RETRIEVAL";
  if(row.call_kind!=="text_agent")return null;
  return row.idempotency_key.endsWith(":synthesis")?"FINAL_SYNTHESIS":"DIRECTION";
}

export class ProductionCallBudgetStore {
  constructor(private readonly pool:pg.Pool) {}

  async budgets(projectId:string,phase="PRE_MEDIA_PHASE") {
    const q=await this.pool.query(
      `SELECT call_kind,limit_count,reserved_count,consumed_count,max_retries,active
       FROM production_phase_call_budgets WHERE project_id=$1 AND phase=$2 ORDER BY call_kind`,
      [projectId,phase],
    );
    return q.rows.map((r:any)=>({callKind:String(r.call_kind),limit:Number(r.limit_count),reserved:Number(r.reserved_count),consumed:Number(r.consumed_count),remaining:Number(r.limit_count)-Number(r.reserved_count)-Number(r.consumed_count),maxRetries:Number(r.max_retries),active:r.active===true}));
  }

  async reserve(input:{projectId:string;workflowId:string;phase:string;stage:string;role:string;callKind:ProductionCallKind;idempotencyKey:string;routingVersionId?:string|null;exactModelId?:string|null;priceSnapshotId?:string|null;estimatedCostUsd?:number|null;provenance?:Record<string,unknown>}):Promise<ProductionCallReservation>{
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const prior=await c.query(`SELECT * FROM production_call_reservations WHERE idempotency_key=$1 FOR UPDATE`,[input.idempotencyKey]);
      if(prior.rowCount){
        const r=prior.rows[0];
        if(r.status==="RESERVED")throw new Error("PRODUCTION_CALL_RESERVATION_AMBIGUOUS");
        throw new Error("DUPLICATE_BILLABLE_EXECUTION_BLOCKED");
      }
      const b=await c.query(`SELECT limit_count,reserved_count,consumed_count,active FROM production_phase_call_budgets WHERE project_id=$1 AND phase=$2 AND call_kind=$3 FOR UPDATE`,[input.projectId,input.phase,input.callKind]);
      if(!b.rowCount||b.rows[0].active!==true)throw new Error(`PRODUCTION_PHASE_BUDGET_UNAVAILABLE:${input.callKind}`);
      const limit=Number(b.rows[0].limit_count), exposure=Number(b.rows[0].reserved_count)+Number(b.rows[0].consumed_count);
      if(exposure+1>limit)throw new Error(`PRODUCTION_PHASE_HARD_CAP_STOP:${input.callKind}`);
      const reservationId=`production-call-${randomUUID()}`,now=new Date().toISOString();
      await c.query(`UPDATE production_phase_call_budgets SET reserved_count=reserved_count+1,updated_at=$4 WHERE project_id=$1 AND phase=$2 AND call_kind=$3`,[input.projectId,input.phase,input.callKind,now]);
      await c.query(`INSERT INTO production_call_reservations(reservation_id,idempotency_key,project_id,workflow_id,phase,stage,role,call_kind,status,routing_version_id,exact_model_id,price_snapshot_id,estimated_cost_usd,reserved_at,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'RESERVED',$9,$10,$11,$12,$13,$14)`,[reservationId,input.idempotencyKey,input.projectId,input.workflowId,input.phase,input.stage,input.role,input.callKind,input.routingVersionId??null,input.exactModelId??null,input.priceSnapshotId??null,input.estimatedCostUsd??null,now,JSON.stringify(input.provenance??{})]);
      await c.query("COMMIT");
      return{reservationId,idempotencyKey:input.idempotencyKey,projectId:input.projectId,workflowId:input.workflowId,phase:input.phase,stage:input.stage,role:input.role,callKind:input.callKind,status:"RESERVED"};
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }

  async reconcile(input:{reservationId:string;providerSubmissionStarted:boolean;success:boolean;calculableCostUsd?:number|null;providerBilledCostUsd?:number|null;provenance?:Record<string,unknown>}):Promise<void>{
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const q=await c.query(`SELECT * FROM production_call_reservations WHERE reservation_id=$1 FOR UPDATE`,[input.reservationId]);
      if(!q.rowCount)throw new Error("PRODUCTION_CALL_RESERVATION_NOT_FOUND");
      const r=q.rows[0];if(r.status!=="RESERVED"){await c.query("COMMIT");return;}
      const consumed=input.providerSubmissionStarted;
      await c.query(`UPDATE production_phase_call_budgets SET reserved_count=GREATEST(0,reserved_count-1),consumed_count=consumed_count+$4,updated_at=$5 WHERE project_id=$1 AND phase=$2 AND call_kind=$3`,[r.project_id,r.phase,r.call_kind,consumed?1:0,new Date().toISOString()]);
      await c.query(`UPDATE production_call_reservations SET status=$2,provider_submission_started=$3,calculable_cost_usd=$4,provider_billed_cost_usd=$5,provider_billed_cost_kind=$6,reconciled_at=$7,provenance=provenance||$8::jsonb WHERE reservation_id=$1`,[input.reservationId,consumed?(input.success?"CONSUMED":"FAILED_AFTER_SUBMISSION"):"RELEASED_BEFORE_SUBMISSION",input.providerSubmissionStarted,input.calculableCostUsd??null,input.providerBilledCostUsd??null,input.providerBilledCostUsd==null?"UNKNOWN":"KNOWN",new Date().toISOString(),JSON.stringify(input.provenance??{})]);
      await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }

  /**
   * Governed repair primitive for a reservation proven to have been consumed
   * without call-specific FETCH_INVOCATION_STARTED evidence. This is never
   * invoked by normal reconciliation and requires exact current identity/state
   * plus an external authorization reference.
   */
  async repairTransportOvercount(input:TransportOvercountRepairInput):Promise<ProductionCallRepairResult>{
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const q=await c.query(`SELECT * FROM production_call_reservations WHERE reservation_id=$1 AND idempotency_key=$2 FOR UPDATE`,[input.reservationId,input.idempotencyKey]);
      if(!q.rowCount)throw new Error("PRODUCTION_CALL_REPAIR_IDENTITY_MISMATCH");
      const r=q.rows[0];
      if(r.workflow_id!==input.workflowId||r.stage!==input.stepId||repairCallLeg(r)!==input.callLeg)throw new Error("PRODUCTION_CALL_REPAIR_SCOPE_MISMATCH");
      const priorRepair=r.provenance?.accountingRepair;
      if(priorRepair!==undefined){
        const exactReplay=priorRepair.kind==="TRANSPORT_OVERCOUNT"
          &&priorRepair.result==="APPLIED"
          &&priorRepair.repairId===input.repairId
          &&priorRepair.reservationId===input.reservationId
          &&priorRepair.idempotencyKey===input.idempotencyKey
          &&priorRepair.workflowId===input.workflowId
          &&priorRepair.stepId===input.stepId
          &&priorRepair.callLeg===input.callLeg
          &&priorRepair.priorStatus===input.expectedStatus
          &&priorRepair.authorizationRef===input.authorizationRef
          &&priorRepair.evidenceRef===input.evidenceRef
          &&priorRepair.reason===input.reason;
        if(!exactReplay)throw new Error("PRODUCTION_CALL_REPAIR_IDENTITY_CONFLICT");
        await c.query("COMMIT");
        return{outcome:"ALREADY_REPAIRED",decremented:false,repairId:input.repairId,reservationId:input.reservationId};
      }
      if(r.status!==input.expectedStatus||r.provider_submission_started!==true)throw new Error("PRODUCTION_CALL_REPAIR_STATE_MISMATCH");
      const evidence=await c.query(`SELECT
        BOOL_OR(state='FETCH_INVOCATION_STARTED') AS transport_started,
        BOOL_OR(metadata ? 'usage') AS usage_exists,
        BOOL_OR(metadata ? 'cost' OR (metadata->'usage') ? 'cost') AS cost_exists
        FROM execution_lifecycle_events
        WHERE workflow_id=$1 AND stage=$2
          AND (metadata->>'reservationId'=$3 OR metadata->>'idempotencyKey'=$4)`,[r.workflow_id,r.stage,r.reservation_id,r.idempotency_key]);
      const observed=evidence.rows[0];
      if(observed.transport_started===true)throw new Error("PRODUCTION_CALL_REPAIR_TRANSPORT_EVIDENCE_CONFLICT");
      if(observed.usage_exists===true||observed.cost_exists===true||r.calculable_cost_usd!==null||r.provider_billed_cost_usd!==null)throw new Error("PRODUCTION_CALL_REPAIR_USAGE_COST_CONFLICT");
      const budget=await c.query(`SELECT consumed_count FROM production_phase_call_budgets WHERE project_id=$1 AND phase=$2 AND call_kind=$3 FOR UPDATE`,[r.project_id,r.phase,r.call_kind]);
      if(!budget.rowCount||Number(budget.rows[0].consumed_count)<1)throw new Error("PRODUCTION_CALL_REPAIR_BUDGET_INVARIANT");
      const now=new Date().toISOString();
      await c.query(`UPDATE production_phase_call_budgets SET consumed_count=consumed_count-1,updated_at=$4 WHERE project_id=$1 AND phase=$2 AND call_kind=$3`,[r.project_id,r.phase,r.call_kind,now]);
      await c.query(`UPDATE production_call_reservations SET status='RELEASED_BEFORE_SUBMISSION',provider_submission_started=FALSE,reconciled_at=$2,provenance=provenance||$3::jsonb WHERE reservation_id=$1`,[input.reservationId,now,JSON.stringify({accountingRepair:{kind:"TRANSPORT_OVERCOUNT",result:"APPLIED",repairId:input.repairId,reservationId:input.reservationId,idempotencyKey:input.idempotencyKey,workflowId:input.workflowId,stepId:input.stepId,callLeg:input.callLeg,authorizationRef:input.authorizationRef,evidenceRef:input.evidenceRef,reason:input.reason,repairedAt:now,priorStatus:r.status}})]);
      await c.query("COMMIT");
      return{outcome:"APPLIED",decremented:true,repairId:input.repairId,reservationId:input.reservationId};
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }

  async workflowEvidence(workflowId:string){const q=await this.pool.query(`SELECT * FROM production_call_reservations WHERE workflow_id=$1 ORDER BY reserved_at`,[workflowId]);return q.rows;}
}
