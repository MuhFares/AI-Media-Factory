import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const ui=readFileSync(path.join(root,"apps/api/src/ai_media_factory/static/app.js"),"utf8");
const python=readFileSync(path.join(root,"apps/api/src/ai_media_factory/main.py"),"utf8");
const nodeApi=readFileSync(path.join(root,"apps/api/src/owner-autonomy-api.ts"),"utf8");

test("A/B/C: signed-out credential, worker and next-cycle controls are visibly gated",()=>{
  assert.match(ui,/function ownerActionAttrs\(key\).*disabled title="Sign in required"/);
  assert.match(ui,/ownerActionAttrs\(key\).*ownerVerifyCredential/s);
  assert.match(ui,/ownerActionAttrs\('worker'\).*ownerWorker\('START'\)/s);
  assert.match(ui,/ownerActionAttrs\(key\).*ownerDecideNext/s);
  assert.match(ui,/Read-only inspection remains available; Owner actions are disabled/);
});

test("D/E: signed-in Verify and Refresh use one canonical credential API and explicit modes",()=>{
  assert.match(ui,/ownerVerifyCredential=async\(bindingId,action\)/);
  assert.match(ui,/\/api\/owner\/credentials\/'\+encodeURIComponent\(bindingId\)\+'\/verify/);
  assert.match(ui,/VERIFY_HEALTH/);
  assert.match(ui,/REFRESH_AND_VERIFY/);
  assert.match(python,/@app\.post\("\/api\/owner\/credentials\/\{binding_id\}\/verify"\)/);
});

test("F/G/H/I: actions expose loading, duplicate protection, success and canonical errors",()=>{
  assert.match(ui,/pendingOwnerActions\.has\(key\)/);
  assert.match(ui,/ACTION_ALREADY_PENDING/);
  assert.match(ui,/fieldErr\(output,loading\|\|'Working…'\)/);
  assert.match(ui,/ownerActionMessages\.set\(key,message\)/);
  for(const code of ["SIGN_IN_REQUIRED","CSRF_INVALID","PROJECT_ACCESS_DENIED","CREDENTIAL_NOT_FOUND","PROVIDER_ERROR","EXPIRED","REVOKED","INSUFFICIENT_SCOPE","CHANNEL_IDENTITY_MISMATCH"]){assert.match(ui,new RegExp(code))}
});

test("J/K: credential success refreshes both credential readiness and Decision Center reads",()=>{
  assert.match(ui,/Credential readiness and Decision Center refreshed/);
  assert.match(ui,/refresh:\(\)=>ownerOperations\(\)/);
  assert.match(ui,/OWNER_OPERATION_READS=.*owner-onboarding.*owner-audit.*owner-credential-health/);
});

test("L/M: L0 manual is ready and budget alerts retain distinct context",()=>{
  assert.match(ui,/Ready — L0 MANUAL/);
  for(const field of ["callKind","phase","used","limit","classification","blocksCurrentOwnerJourney"]){assert.match(ui,new RegExp(`a\\.${field}`))}
  assert.match(nodeApi,/classification:"CURRENT_CAPACITY_EXHAUSTION"/);
  assert.match(nodeApi,/blocksCurrentOwnerJourney:false/);
});

test("N/O: next-cycle DEFER is wired and no Owner handler silently returns on missing rationale",()=>{
  assert.match(ui,/\['APPROVE','REJECT','DEFER','REQUEST_CHANGES'\]/);
  assert.match(ui,/Decision recorded:.*No workflow was automatically started/);
  const actions=ui.slice(ui.indexOf("window.ownerActivateRoute"),ui.indexOf("function render()",ui.indexOf("window.ownerActivateRoute")));
  assert.doesNotMatch(actions,/if\(!(?:reason|rationale)\)return/);
  assert.match(actions,/INPUT_REQUIRED/);
});

test("P/Q/R: Node remains mutation authority, Python is proxy-only, and UI load performs no provider call",()=>{
  assert.match(python,/settings\.runtime_api_url/);
  assert.match(python,/@app\.post\("\/api\/owner\/credentials\/\{binding_id\}\/verify"\)/);
  assert.doesNotMatch(python,/refresh_token\s*=|access_token\s*=|google\.oauth|youtube\.videos\(\)\.insert/);
  assert.match(nodeApi,/credentialHealthVerifier/);
  const load=ui.slice(ui.indexOf("async function ownerOperations()"),ui.indexOf("window.ownerActivateRoute"));
  assert.doesNotMatch(load,/method\s*:\s*['"]POST/);
});
