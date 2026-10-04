import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const source=readFileSync(path.join(root,"apps/api/src/ai_media_factory/static/app.js"),"utf8");
const helperStart=source.indexOf("const OWNER_OPERATION_READS=");
const helperEnd=source.indexOf("async function ownerOperations()",helperStart);
const helper=helperStart>=0&&helperEnd>helperStart?source.slice(helperStart,helperEnd):null;
assert.ok(helper,"Owner Operations settled-read helper must exist");

async function runReads(read){
  const context={Promise};
  vm.createContext(context);
  vm.runInContext(`${helper};globalThis.run=ownerOperationReads`,context);
  return context.run("project_id=morroway",read);
}

test("Owner Operations full read set settles successfully without mutations",async()=>{
  const calls=[];
  const results=await runReads(async url=>{calls.push(url);return {url}});
  assert.equal(results.length,9);
  assert.ok(results.every(x=>x.status==="fulfilled"));
  assert.ok(calls.every(x=>x.startsWith("/api/runtime/")&&x.includes("project_id=morroway")));
  assert.ok(calls.includes("/api/runtime/owner-credential-health?project_id=morroway"));
  assert.ok(calls.includes("/api/runtime/owner-wan-supervised?project_id=morroway"));
});

test("credential-health failure is isolated from worker and Wan reads",async()=>{
  const results=await runReads(async url=>{
    if(url.includes("owner-credential-health"))throw new Error("credential read unavailable");
    if(url.includes("owner-health"))return {worker:{liveCount:1},wan:{futureSubmissionsAllowed:false}};
    return {};
  });
  assert.equal(results[7].status,"rejected");
  assert.equal(results[1].status,"fulfilled");
  assert.equal(results[1].value.worker.liveCount,1);
  assert.equal(results[1].value.wan.futureSubmissionsAllowed,false);
});

test("Owner Operations renders explicit partial-failure and Wan safety states",()=>{
  assert.match(source,/Credential state: UNKNOWN \/ UNAVAILABLE/);
  assert.match(source,/Credential health.*unavailable/s);
  assert.match(source,/Worker, provider and Wan health/);
  assert.match(source,/WAN MODE: TEMPORARY SUPERVISED/);
  assert.match(source,/Each scene card independently reports whether all current generation gates pass/);
  assert.match(source,/maximum one POST per logical scene/);
  assert.match(source,/no batch or automatic retry/);
  assert.match(source,/Video Generation — Supervised Wan/);
  assert.match(source,/HISTORICAL CANARY/);
  assert.match(source,/Wan eligibility/);
  assert.match(source,/active execution/);
  assert.match(source,/Generate is not offered because all current governance gates do not pass/);
  assert.match(source,/Promise\.allSettled/);
});

test("Owner Operations page load performs read-only fetches only",()=>{
  const block=source.slice(source.indexOf("async function ownerOperations()"),source.indexOf("window.ownerActivateRoute"));
  assert.doesNotMatch(block,/method\s*:\s*['\"](?:POST|PUT|PATCH|DELETE)/i);
  assert.match(block,/Verify Health/);
});

test("historical scene from the old runtime is visible but fail-closed",()=>{
  const start=source.indexOf("function supervisedWanSceneUiState");
  const end=source.indexOf("async function ownerOperations()",start);
  const context={};vm.createContext(context);vm.runInContext(`${source.slice(start,end)};globalThis.classify=supervisedWanSceneUiState`,context);
  const state=context.classify({workflowId:"wf-p4-canary-2b0da0ba762b65477107",eligible:true});
  assert.equal(state.historical,true);
  assert.equal(state.eligible,false);
  assert.equal(state.reason,"SOURCE_VISUAL_RUNTIME_REFERENCE_UNSUPPORTED");
});
