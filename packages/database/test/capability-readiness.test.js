import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCapabilityReadiness, YOUTUBE_CREDENTIAL_DEPENDENCY } from "../dist/index.js";

const healthy={projectActive:true,projectAuthorized:true,workerHealthy:true,routingHealthy:true,providerCapabilityHealthy:true,budgetAvailable:true,youtubeCredentialFresh:false};

test("A/B/C/D/I: stale YouTube credential never blocks unrelated capabilities",()=>{
  for(const stage of ["RESEARCH","CEO","BRIEF","WRITER","SCENES","VISUAL_DIRECTION","IMAGE_GENERATION"]){
    const result=evaluateCapabilityReadiness({...healthy,stage});assert.equal(result.ready,true,stage);assert.equal(result.youtubeCredentialRequired,false,stage);
  }
  const wan=evaluateCapabilityReadiness({...healthy,stage:"WAN",routingHealthy:false,wanGovernanceReady:true});assert.equal(wan.ready,true);assert.equal(wan.youtubeCredentialRequired,false);
  assert.equal(YOUTUBE_CREDENTIAL_DEPENDENCY.IMAGE_GENERATION,false);
});

test("E/F: publication and YouTube analytics retain fresh credential gates",()=>{
  for(const stage of ["YOUTUBE_PUBLICATION","YOUTUBE_ANALYTICS"]){const blocked=evaluateCapabilityReadiness({...healthy,stage});assert.equal(blocked.ready,false);assert.deepEqual(blocked.failures,["YOUTUBE_CREDENTIAL_REFRESH_REQUIRED"]);assert.equal(evaluateCapabilityReadiness({...healthy,stage,youtubeCredentialFresh:true}).ready,true)}
});

test("G/H: relevant provider and budget failures remain fail-closed",()=>{
  assert.deepEqual(evaluateCapabilityReadiness({...healthy,stage:"IMAGE_GENERATION",providerCapabilityHealthy:false}).failures,["PROVIDER_CAPABILITY_UNHEALTHY"]);
  assert.deepEqual(evaluateCapabilityReadiness({...healthy,stage:"WRITER",budgetAvailable:false}).failures,["CAPABILITY_BUDGET_UNAVAILABLE"]);
});
