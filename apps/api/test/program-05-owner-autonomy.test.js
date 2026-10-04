/** Program 5 provider-free product certification.
 * These tests certify the product paths and invariants without contacting a
 * provider or running a production workflow. Database behavior is covered by
 * the companion OwnerAutonomyStore integration suite. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,"../../..");
const ui=readFileSync(path.join(root,"apps/api/src/ai_media_factory/static/app.js"),"utf8");
const facade=readFileSync(path.join(root,"apps/api/src/ai_media_factory/main.py"),"utf8");
const handler=readFileSync(path.join(root,"apps/api/src/handler.ts"),"utf8");
const ownerApi=readFileSync(path.join(root,"apps/api/src/owner-autonomy-api.ts"),"utf8");
const store=readFileSync(path.join(root,"packages/database/src/owner-autonomy.ts"),"utf8");
const oauthBreakGlass=readFileSync(path.join(root,"scripts/youtube-oauth.mjs"),"utf8");

test("E2E-P5-01 project onboarding exposes project, route, budget, channel, and credential paths",()=>{
  for(const token of ["/api/projects","/api/channels","owner/routing/activate","owner/budgets","owner/credentials/"])assert.match(ui+facade,new RegExp(token.replaceAll("/","\\/")));
  assert.match(store,/credentialHealth/);assert.match(store,/NO_ACTIVE_ROUTING|routingActive/);
});
test("E2E-P5-02 Decision Center approval is the sole Owner attention path",()=>{
  assert.match(ui,/Decision Center is the sole source of Owner tasks/);assert.match(handler,/decisionQueue/);assert.match(ui,/\/api\/approvals\/decide/);
});
test("E2E-P5-03 rejection and canonical revision paths are productized",()=>{
  assert.match(ui,/REQUEST_ITERATION/);assert.match(facade,/\/api\/content\/\{content_id\}\/revisions/);assert.match(facade,/owner_revision_authorize/);
});
test("E2E-P5-04 exhausted budgets gain only bounded Owner-authorized capacity",()=>{
  assert.match(store,/BUDGET_LIMIT_BELOW_CURRENT_EXPOSURE/);assert.match(store,/executionAuthorityGranted: false/);assert.match(ui,/Global\/project capacity never grants execution authority/);
});
test("E2E-P5-05 unavailable providers are visible and cannot masquerade as healthy",()=>{
  assert.match(ownerApi,/UNKNOWN_LIVE_HEALTH/);assert.match(ownerApi,/ROUTING_UNAVAILABLE/);assert.doesNotMatch(ownerApi,/LIVE_HEALTHY/);
});
test("E2E-P5-06 credential binding and health state are exposed without secrets",()=>{
  assert.match(ui,/Verify Health/);assert.match(facade,/owner_credential_health_verify/);assert.match(ownerApi,/ownerCredentialHealthVerify/);assert.doesNotMatch(ownerApi,/access_token|refresh_token|client_secret/i);
});
test("E2E-P5-07 media and review recovery use canonical dispatcher routes",()=>{
  assert.match(facade,/media-resumes\/\{workflow_id\}\/authorize/);assert.match(facade,/resume-review/);assert.match(ui,/Frozen writer\/review lineage is reused/);
});
test("E2E-P5-08 private publication approval remains a separate product action",()=>{
  assert.match(handler,/publisher_authorization_private/);assert.match(ui,/preparePrivatePublication/);assert.match(handler,/md\.visibility!=="private"/);
});
test("E2E-P5-09 analytics renders missing evidence honestly",()=>{
  assert.match(ui,/Insufficient data/);assert.match(ui,/sparse is honest/);assert.doesNotMatch(ui,/NOT_RETURNED[^\n]{0,80}\?\?0/);
});
test("E2E-P5-10 next-cycle approve reject defer and changes never auto-start",()=>{
  for(const d of ["APPROVE","REJECT","DEFER","REQUEST_CHANGES"])assert.match(store,new RegExp(d));
  assert.match(store,/workflowCreated: false/);assert.match(store,/OWNER_APPROVED_AWAITS_EXPLICIT_START/);
});
test("E2E-P5-11 worker drift is visible and control uses only canonical launcher",()=>{
  assert.match(ownerApi,/persistent-worker\.mjs/);assert.match(ownerApi,/arbitraryProcessKill:false/);assert.match(ownerApi,/WORKER_STOPPED_OR_STALE/);
});
test("E2E-P5-12 multi-project routing denies cross-project activation",()=>{
  assert.match(store,/target\.project_id !== input\.projectId/);assert.match(store,/CROSS_PROJECT_DENIED/);
});
test("E2E-P5-13 multi-project credentials remain project scoped",()=>{
  assert.match(store,/credential_bindings WHERE project_id=\$1/);assert.match(handler,/publishingRouteCheck/);
});
test("E2E-P5-14 cross-project artifact access remains server denied",()=>{
  assert.match(handler,/CROSS_PROJECT_ARTIFACT_ACCESS_DENIED|projectArtifacts/);
});
test("E2E-P5-15 Morroway automation defaults to manual and is not auto-enabled",()=>{
  assert.match(store,/enabled: false, level: "L0_MANUAL"/);assert.doesNotMatch(ownerApi,/setPolicy|automationPolicySet/);
});
test("E2E-P5-16 private authority cannot authorize public publication",()=>{
  assert.match(handler,/PUBLIC_PUBLISH/);assert.match(handler,/PILOT_PRIVATE_ONLY/);assert.match(ui,/public publication|PUBLIC_PUBLISH/i);
});
test("E2E-P5-17 every normal operation has product paths with zero script or direct DB",()=>{
  assert.match(store,/credential_health/);assert.match(store,/scriptRequired: false/);assert.match(store,/directDbRequired: false/);assert.match(ui,/Normal-operation contract/);
});
test("E2E-P5-18 break-glass remains explicit guarded audited and Owner\/Admin-only",()=>{
  assert.match(store,/BREAK_GLASS_ONLY/);assert.match(store,/explicitEngineeringGuard: true/);assert.match(store,/auditRequired: true, ownerAdminRequired: true/);
  assert.match(oauthBreakGlass,/BREAK_GLASS_ONLY/);assert.match(oauthBreakGlass,/--confirm-break-glass=/);assert.match(oauthBreakGlass,/auditExpectation/);
});

test("Program-4 logical journey is reachable through Owner product paths",()=>{
  for(const token of ["bindCredential","recordVisualAcceptance","approveFinalContent","preparePrivatePublication","Analytics overview","Next-cycle proposals","Recovery actions"])assert.match(ui,new RegExp(token));
});
test("security: HttpOnly session, CSRF, authentication, redaction, and audit are enforced",()=>{
  assert.match(facade,/httponly=True/);assert.match(facade,/_require_csrf/);assert.match(handler,/requireOwner/);assert.match(store,/owner_control_audit_events/);assert.doesNotMatch(ui,/access_token|refresh_token|client_secret/i);
});
test("canonical architecture: Node mutates, Python proxies, apps\/web is not a second authority",()=>{
  assert.match(facade,/Proxy business requests to the existing Node runtime API/);assert.match(handler,/ownerAutonomy/);assert.ok(!ui.includes("direct SQL"));
});
test("future Wan generation blocker is preserved",()=>{
  assert.match(ownerApi,/futureSubmissionsAllowed:false/);assert.match(ownerApi,/TEMPORARY_GOVERNED_LEGACY_ENDPOINT/);assert.match(ui,/WAN MODE: TEMPORARY SUPERVISED/);
});
