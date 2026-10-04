import test,{after,before} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createWorkflowApiHandler} from "../dist/handler.js";
import {readFileSync} from "node:fs";

let server,base,audits=0,probes=0;
const originalToken=process.env.AMF_OWNER_TOKEN;
before(async()=>{
  process.env.AMF_OWNER_TOKEN="diagnostic-owner-token";
  const handler=createWorkflowApiHandler({
    persistence:{},queue:{},control:{},
    ownerAutonomy:{recordOwnerAction:async()=>{audits++;return{eventId:"audit-1",createdAt:"2026-10-02T00:00:00.000Z"}}},
    workerDiagnostics:{probeOpenRouterEgress:async()=>{probes++;return{
      requestId:"worker-diagnostic-internal",command:"PROBE_OPENROUTER_EGRESS",timestamp:"2026-10-02T00:00:00.000Z",
      workerInstanceId:"worker-1",workerPid:1234,workerBuild:"build-1",dnsStatus:"PASS",tcpStatus:"PASS",tlsStatus:"PASS",
      httpStatus:200,latencyMs:50,errorClass:null,errorCode:null,providerReached:true,authValid:true,outcome:"PASS",
    }}},
  });
  server=createServer((req,res)=>void handler(req,res));await new Promise(r=>server.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(r=>server.close(r));if(originalToken===undefined)delete process.env.AMF_OWNER_TOKEN;else process.env.AMF_OWNER_TOKEN=originalToken});

test("unauthenticated diagnostic probe is rejected before worker dispatch",async()=>{
  const r=await fetch(base+"/control/owner/diagnostics/openrouter-egress",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({projectId:"morroway",reason:"test"})});
  assert.equal(r.status,401);assert.equal(probes,0);assert.equal(audits,0);
});

test("authorized diagnostic reaches worker, emits audit, and returns safe fields only",async()=>{
  const r=await fetch(base+"/control/owner/diagnostics/openrouter-egress",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer diagnostic-owner-token"},body:JSON.stringify({projectId:"morroway",reason:"bounded worker egress proof"})});
  assert.equal(r.status,200);const body=await r.json();assert.equal(body.probe.httpStatus,200);assert.equal(probes,1);assert.equal(audits,1);
  assert.deepEqual(Object.keys(body.probe).sort(),["dnsStatus","errorClass","errorCode","httpStatus","latencyMs","outcome","providerReached","tcpStatus","timestamp","tlsStatus","workerBuild","workerInstanceId","workerPid"].sort());
  const serialized=JSON.stringify(body).toLowerCase();for(const forbidden of ["authorization","api_key","authvalid","chat/completions","responsebody"])assert.ok(!serialized.includes(forbidden));
});

test("diagnostic implementation has no workflow, budget, or completion transport path",()=>{
  const source=readFileSync(new URL("../../../packages/database/src/worker-diagnostic-channel.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/chat\/completions|workflow_jobs|workflow_instances|production_phase_call_budgets|production_call_reservations/i);
});
