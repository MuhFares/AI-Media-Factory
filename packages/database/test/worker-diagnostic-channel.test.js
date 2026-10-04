import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  PostgresWorkerDiagnosticClient,
  PostgresWorkerDiagnosticListener,
  WorkerDiagnosticGuard,
} from "../dist/index.js";

class FakeClient extends EventEmitter {
  constructor(bus){super();this.bus=bus;this.released=false;bus.push(this)}
  async query(sql,args=[]){
    if(String(sql).includes("pg_notify")){
      const [channel,payload]=args;
      queueMicrotask(()=>this.bus.forEach(c=>c.emit("notification",{channel,payload})));
    }
    return {rows:[]};
  }
  release(){this.released=true}
}
class FakePool { constructor(){this.clients=[]} async connect(){return new FakeClient(this.clients)} }

test("worker-owned channel returns only safe non-inference probe metadata",async()=>{
  const pool=new FakePool();
  const listener=new PostgresWorkerDiagnosticListener(pool,{workerInstanceId:"worker-1",workerBuild:"build-1",workerPid:1234},async()=>({httpStatus:200,latencyMs:42,providerReached:true,authValid:true}),{cooldownMs:0});
  await listener.start();
  const result=await new PostgresWorkerDiagnosticClient(pool,1000).probeOpenRouterEgress();
  assert.equal(result.outcome,"PASS");assert.equal(result.workerInstanceId,"worker-1");assert.equal(result.workerBuild,"build-1");
  assert.equal(result.httpStatus,200);assert.equal(result.dnsStatus,"PASS");assert.equal(result.tcpStatus,"PASS");assert.equal(result.tlsStatus,"PASS");
  const serialized=JSON.stringify(result).toLowerCase();
  for(const forbidden of ["authorization","api_key","chat/completions","responsebody","accountmetadata"])assert.ok(!serialized.includes(forbidden));
  await listener.close();
});

test("concurrent worker probes coalesce by rejecting the second active entry",()=>{
  let now=1000;const guard=new WorkerDiagnosticGuard(10_000,()=>now);
  assert.equal(guard.enter(),"ENTERED");
  assert.equal(guard.enter(),"PROBE_ALREADY_ACTIVE");
  guard.complete();
  assert.equal(guard.enter(),"PROBE_COOLDOWN_ACTIVE");
  now+=10_001;assert.equal(guard.enter(),"ENTERED");
});

test("worker diagnostic timeout is bounded and does not fall through to execution",async()=>{
  const pool=new FakePool();
  await assert.rejects(()=>new PostgresWorkerDiagnosticClient(pool,10).probeOpenRouterEgress(),/WORKER_DIAGNOSTIC_TIMEOUT/);
});

test("worker transport errors expose only safe classification",async()=>{
  const pool=new FakePool();
  const listener=new PostgresWorkerDiagnosticListener(pool,{workerInstanceId:"worker-2",workerBuild:"build-2",workerPid:5678},async()=>{
    throw Object.assign(new TypeError("private fetch prose"),{cause:Object.assign(new Error("private socket prose"),{code:"EACCES"})});
  },{cooldownMs:0});
  await listener.start();
  const result=await new PostgresWorkerDiagnosticClient(pool,1000).probeOpenRouterEgress();
  assert.equal(result.outcome,"FAIL");assert.equal(result.tcpStatus,"FAIL");assert.equal(result.errorCode,"EACCES");
  assert.ok(!JSON.stringify(result).includes("private"));
  await listener.close();
});

test("dedicated LISTEN client database error is handled without an uncaught process error",async()=>{
  const pool=new FakePool();
  const listener=new PostgresWorkerDiagnosticListener(pool,{workerInstanceId:"worker-3",workerBuild:"build-3",workerPid:9012},async()=>({httpStatus:200,latencyMs:1,providerReached:true,authValid:true}),{cooldownMs:0});
  await listener.start();
  assert.doesNotThrow(()=>pool.clients[0].emit("error",Object.assign(new Error("database disconnected"),{code:"57P01"})));
  await listener.close();
});
