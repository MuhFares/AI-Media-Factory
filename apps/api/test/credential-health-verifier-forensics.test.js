import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProductionCredentialHealthVerifier } from "../dist/credential-health-verifier.js";

const credential = () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"amf-credential-forensics-"));
  const file=path.join(dir,"credential.json");
  fs.writeFileSync(file,JSON.stringify({provider:"google",type:"youtube-oauth-desktop",clientId:"id",clientSecret:"secret",refreshToken:"refresh",scopes:["https://www.googleapis.com/auth/youtube.upload","https://www.googleapis.com/auth/youtube.readonly","https://www.googleapis.com/auth/yt-analytics.readonly"],obtainedAt:"2026-01-01T00:00:00.000Z"}));
  return {dir,file};
};
const input=(file)=>({action:"VERIFY_HEALTH",provider:"youtube",credentialReference:file,expectedExternalChannelId:"channel-1",projectId:"morroway",bindingId:"binding-1",channelId:"channel-binding-1"});

test("OAuth HTTP failure persists safe stage/status/code and never serializes provider detail",async(t)=>{
  const c=credential();t.after(()=>fs.rmSync(c.dir,{recursive:true,force:true}));
  const verifier=new ProductionCredentialHealthVerifier(async()=>({ok:false,status:400,json:async()=>({error:"invalid_grant",error_description:"sensitive provider detail"})}));
  const result=await verifier.verify(input(c.file));
  assert.equal(result.state,"ERROR");assert.equal(result.reasonCode,"OAUTH_REFRESH_HTTP_ERROR");
  const failure=result.transportLedger.find(x=>x.stage==="OAUTH_REFRESH"&&x.outcome==="FAILED");
  assert.deepEqual({status:failure.httpStatus,code:failure.providerErrorCode,retryable:failure.retryable},{status:400,code:"INVALID_GRANT",retryable:false});
  assert.doesNotMatch(JSON.stringify(result),/sensitive provider detail|clientSecret|refreshToken|authorization/i);
  assert.equal(result.transportLedger.some(x=>x.stage==="YOUTUBE_IDENTITY"),false);
});

test("successful HTTP response without access token is classified at refresh response boundary",async(t)=>{
  const c=credential();t.after(()=>fs.rmSync(c.dir,{recursive:true,force:true}));
  const verifier=new ProductionCredentialHealthVerifier(async()=>({ok:true,status:200,json:async()=>({expires_in:3600})}));
  const result=await verifier.verify(input(c.file));
  assert.equal(result.reasonCode,"OAUTH_REFRESH_RESPONSE_INVALID");
  const failure=result.transportLedger.find(x=>x.stage==="OAUTH_REFRESH"&&x.outcome==="FAILED");
  assert.equal(failure.httpStatus,200);assert.equal(failure.providerErrorCode,"ACCESS_TOKEN_NOT_RETURNED");
  assert.equal(result.transportLedger.some(x=>x.stage==="YOUTUBE_IDENTITY"),false);
});

test("identity failure is distinct and begins only after refresh succeeds",async(t)=>{
  const c=credential();t.after(()=>fs.rmSync(c.dir,{recursive:true,force:true}));let calls=0;
  const verifier=new ProductionCredentialHealthVerifier(async()=>++calls===1
    ? {ok:true,status:200,json:async()=>({access_token:"ephemeral",expires_in:3600})}
    : {ok:false,status:403,json:async()=>({error:"insufficientPermissions"})});
  const result=await verifier.verify(input(c.file));
  assert.equal(result.reasonCode,"YOUTUBE_IDENTITY_HTTP_ERROR");assert.equal(calls,2);
  assert.equal(result.transportLedger.some(x=>x.stage==="OAUTH_REFRESH"&&x.outcome==="SUCCEEDED"),true);
  const failure=result.transportLedger.find(x=>x.stage==="YOUTUBE_IDENTITY"&&x.outcome==="FAILED");
  assert.equal(failure.httpStatus,403);assert.equal(failure.providerErrorCode,"INSUFFICIENTPERMISSIONS");
  assert.doesNotMatch(JSON.stringify(result),/ephemeral|clientSecret|refreshToken|authorization/i);
});
