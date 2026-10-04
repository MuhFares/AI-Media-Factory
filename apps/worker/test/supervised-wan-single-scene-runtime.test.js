import { test } from "node:test";
import { strict as assert } from "node:assert";
import { SupervisedWanSingleSceneRunner } from "@ai-media-factory/worker";

const execution = {
  wanExecutionId:"wan-exec-test", idempotencyIdentity:"idem-test", projectId:"morroway",
  contentId:"content-test", workflowId:"workflow-test", sceneId:"scene-1",
  sourceVisualArtifactId:"visual-test", sourceVisualSha256:"a".repeat(64),
  clientExecutionId:"client-test", provider:"self-hosted-video", model:"wan2.2",
  endpointId:"ry49lc45y50ldy", modelConfig:{prompt:"slow cinematic motion"},
  providerJobId:null, state:"SUBMISSION_STARTED", ownerActor:"owner-test",
  ownerRationale:"bounded test", authorizationId:"auth-test", budgetClaimId:"budget-test",
  budgetState:"CONSUMED", providerPostCount:1, submissionStartedAt:new Date().toISOString(),
  acknowledgedAt:null, completedAt:null, failureClass:null, reconciliationState:"NONE",
  outputEvidence:null, claimedByWorker:"worker-test", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()
};

test("supervised runner makes exactly one provider call and persists the same acknowledged job", async () => {
  const events=[]; let providerCalls=0;
  const store={
    claimNext:async()=>execution,
    acknowledge:async(id,job)=>{events.push(["ACKNOWLEDGED",id,job]);return execution},
    complete:async(id,evidence)=>{events.push(["COMPLETED",id,evidence.providerJobId]);return execution},
    requireManualReconciliation:async()=>{throw new Error("unexpected reconciliation")},
    fail:async()=>{throw new Error("unexpected failure")}
  };
  const provider={generate:async request=>{providerCalls+=1;assert.equal(request.clientExecutionId,"client-test");return{jobId:"provider-job-1",videoId:"video-1",url:"memory://video",model:"wan2.2"}}};
  const runner=new SupervisedWanSingleSceneRunner(store,provider,{resolve:async()=>({imageBase64:"safe-fixture"})},"worker-test");
  assert.equal(await runner.runOnce(),true);
  assert.equal(providerCalls,1);
  assert.deepEqual(events.map(x=>x[0]),["ACKNOWLEDGED","COMPLETED"]);
  assert.equal(events[0][2],events[1][2]);
});

test("ambiguous acknowledgement requires reconciliation and never retries", async () => {
  let providerCalls=0; const events=[];
  const store={
    claimNext:async()=>execution,
    acknowledge:async()=>{throw new Error("unexpected acknowledge")},
    complete:async()=>{throw new Error("unexpected completion")},
    requireManualReconciliation:async(id,reason)=>{events.push([id,reason]);return execution},
    fail:async()=>{throw new Error("unexpected failure")}
  };
  const provider={generate:async()=>{providerCalls+=1;throw Object.assign(new Error("ack ambiguous"),{reconciliationRequired:true})}};
  const runner=new SupervisedWanSingleSceneRunner(store,provider,{resolve:async()=>({imageBase64:"safe-fixture"})},"worker-test");
  assert.equal(await runner.runOnce(),true);
  assert.equal(providerCalls,1);
  assert.deepEqual(events,[["wan-exec-test","SUBMISSION_ACK_AMBIGUOUS"]]);
});

test("completed provider output that cannot be persisted becomes manual reconciliation", async () => {
  let providerCalls=0; const events=[];
  const store={
    claimNext:async()=>execution,
    acknowledge:async()=>execution,
    complete:async()=>{throw new Error("must not complete without output")},
    requireManualReconciliation:async(id,reason)=>{events.push([id,reason]);return execution},
    fail:async()=>{throw new Error("provider completion is not a definitive generation failure")}
  };
  const provider={generate:async()=>{providerCalls+=1;return{jobId:"provider-job-2",url:"data:video/mp4;base64,AAAA",model:"wan2.2"}}};
  const output={persist:async()=>{throw new Error("isolated output failure")}};
  const runner=new SupervisedWanSingleSceneRunner(store,provider,{resolve:async()=>({imageBase64:"safe-fixture"})},"worker-test",output);
  assert.equal(await runner.runOnce(),true);
  assert.equal(providerCalls,1);
  assert.deepEqual(events,[["wan-exec-test","OUTPUT_PERSISTENCE_OR_LEDGER_COMPLETION_FAILED"]]);
});
