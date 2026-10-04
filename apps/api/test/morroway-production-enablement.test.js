import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, ContentStore, LifecycleStore, ChannelStore, AutomationStore, ProductionCallBudgetStore, ProductionModelRoutingStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

process.env.AMF_OWNER_TOKEN = "test-owner-token";
process.env.TEXT_AGENT_PROVIDER = "agentrouter";
process.env.OPENAI_API_KEY = "fixture";
process.env.ANTHROPIC_AUTH_TOKEN = "fixture";
process.env.SEARCH_API_SERPER = "fixture";
process.env.OPENROUTER_API_KEY = "fixture";
process.env.RUNPOD_API_KEY = "fixture";
process.env.RUNPOD_ZIMAGE_ENDPOINT_ID = "fixture-zimage";
process.env.RUNPOD_VIDEO_ENDPOINT_ID = "fixture-wan";
process.env.VOICETUT_TTS_ENDPOINT_ID = "fixture-voice";
const AUTH={Authorization:"Bearer test-owner-token"};
const DATABASE_URL=process.env.TEST_DATABASE_URL??(()=>{if(!process.env.DATABASE_URL)return "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";const u=new URL(process.env.DATABASE_URL);u.pathname="/ai_media_factory_test";return u.toString();})();
let pool,server,base,persistence,queue;
async function req(path,options={}){const res=await fetch(`${base}${path}`,{headers:{"Content-Type":"application/json",...AUTH},...options});return {status:res.status,body:await res.json()};}
const artifact=(workflowId,artifactId,kind,parentArtifact)=>({artifactId,workflowId,kind,producerAgent:"fixture",correlationId:"corr-enablement",status:"completed",payload:{fixture:true,path:`fixture://${artifactId}`},contentType:"application/json",schemaVersion:"1.0",createdAt:new Date().toISOString(),...(parentArtifact?{parentArtifact}:{})});

before(async()=>{
  if(DATABASE_URL===process.env.DATABASE_URL)throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool=createPool({connectionString:DATABASE_URL});await migrate(pool);
  await pool.query(`TRUNCATE publication_preparations,content_review_decisions,content_visual_quality_reviews,content_revision_requests,content_items,automation_call_budgets,channels,credential_bindings,control_projects,control_approvals,workflow_jobs,workflow_submissions,artifacts,capability_executions,execution_evidence,amf_worker_presence RESTART IDENTITY CASCADE`);
  const control=new ControlPlaneStore(pool);await control.registerProject({projectId:"morroway",displayName:"Morroway",createdBy:"test",metadata:{}});await migrate(pool);
  const now=new Date().toISOString();await pool.query(`INSERT INTO amf_worker_presence(worker_instance_id,build_id,runtime_mode,launcher,node_version,started_at,last_heartbeat_at,process_id,singleton_key,worker_role) VALUES('cycle-preflight-worker','fixture-build','PERSISTENT_PRODUCTION_WORKER','persistent-worker-script','test',$1,$1,$2,'amf-production-worker','canonical-production-queue-worker') ON CONFLICT(worker_instance_id) DO UPDATE SET last_heartbeat_at=$1,process_id=$2,singleton_key='amf-production-worker',worker_role='canonical-production-queue-worker',launcher='persistent-worker-script'`,[now,process.pid]);
  for(const [kind,limit] of [["research",1],["text_agent",10]])await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES('morroway','PRE_MEDIA_PHASE',$1,$2,0,0,0,TRUE,$3) ON CONFLICT(project_id,phase,call_kind) DO UPDATE SET limit_count=EXCLUDED.limit_count,reserved_count=0,consumed_count=0,max_retries=0,active=TRUE,updated_at=EXCLUDED.updated_at`,[kind,limit,now]);
  persistence=new PostgresPersistence(pool);queue=new PostgresQueue(pool);const channels=new ChannelStore(pool);const automation=new AutomationStore(pool);
  const routing={resolve:async(role,{projectId})=>({routingVersionId:"amf-balanced-production-routing-v1-morroway",profile:"BALANCED",role,slot:"primary",model:{orchestrator:"openai/gpt-oss-20b",research:"openai/gpt-6-luna",ceo:"openai/gpt-6-luna",planner:"openai/gpt-oss-20b",hooks:"z-ai/glm-5.3-flash",writer:"inclusionai/ling-3.0-flash",director:"inclusionai/ling-3.0-flash","visual-director":"inclusionai/ling-3.0-flash",review:"openai/gpt-oss-20b",qa:"openai/gpt-oss-20b"}[role],priceSnapshotId:`price-${role}`})};
  const handler=createWorkflowApiHandler({persistence,queue,control,lifecycle:new LifecycleStore(pool),content:new ContentStore(pool),channels,automation,productionModelRouting:routing,productionCallBudgets:new ProductionCallBudgetStore(pool)});
  server=createServer((a,b)=>void handler(a,b));await new Promise(r=>server.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(pool){await pool.query(`DELETE FROM amf_worker_presence WHERE worker_instance_id='cycle-preflight-worker'`);await pool.end();}});

test("provider-free Owner product path closes all production enablement P0s",async()=>{
  const brief={topic:"How Cairo street signs tell a story",objective:"Create one grounded Morroway factual micro-story",targetPlatform:"youtube",format:"short",targetAudience:"curious Arabic-speaking adults",contentType:"factual_micro_story",language:"ar-EG",targetDurationSeconds:25,sceneTarget:3,researchRequirement:"required",characterRequirement:"none",identityCriticalHuman:false,aspectRatio:"9:16",brandProject:"morroway"};
  const created=await req("/control/content",{method:"POST",body:JSON.stringify({projectId:"morroway",title:"Cairo in three details",objective:brief.objective,topic:brief.topic,productionBrief:brief})});
  assert.equal(created.status,201);const contentId=created.body.content.contentId;
  const channels=await req("/control/channels?projectId=morroway");assert.equal(channels.body.channels.length,1);assert.equal(channels.body.channels[0].externalChannelId,"UCA5ECzcK_96akfUT5fQUT3A");
  const budgets=await req("/control/automation/budgets?projectId=morroway");assert.equal(budgets.body.budgets.filter(b=>Object.keys({research:1,text_agent:1,image_generation:1,video_generation:1,voice_generation:1,private_upload:1}).includes(b.callKind)).reduce((n,b)=>n+b.limit,0),14);assert.ok(budgets.body.budgets.every(b=>b.costKind==="KNOWN"||b.costKind==="UNKNOWN"));
  const started=await req(`/control/content/${contentId}/start-production`,{method:"POST",body:"{}"});assert.equal(started.status,201);assert.equal(started.body.status,"QUEUED_PRE_MEDIA_PHASE");assert.equal(started.body.preflight.ready,true);assert.equal(started.body.preflight.mediaReadinessRequired,false);assert.equal(started.body.terminalState,"OWNER_PRE_MEDIA_REVIEW_REQUIRED");const workflowId=started.body.workflowId;
  const phaseSubmission=await queue.loadSubmissionByWorkflow(workflowId);assert.equal(phaseSubmission.directive,"produce-pre-media");assert.equal(phaseSubmission.commandContext.projectId,"morroway");assert.equal(phaseSubmission.commandContext.productionPhase,"PRE_MEDIA_PHASE");assert.equal(phaseSubmission.commandContext.mediaAuthority,"NOT_GRANTED");assert.equal(phaseSubmission.definition.steps.at(-1).id,"owner-pre-media-gate");assert.equal(phaseSubmission.definition.steps.some(s=>["scene-image","video","tts","composer","publisher"].includes(s.agent)),false);
  const repeated=await req(`/control/content/${contentId}/start-production`,{method:"POST",body:"{}"});assert.equal(repeated.status,200);assert.equal(repeated.body.workflowId,workflowId);assert.equal((await pool.query(`SELECT count(*)::int n FROM workflow_submissions WHERE submission_key=$1`,[`content-production:${contentId}`])).rows[0].n,1);
  const kinds=[["research","research_report"],["script","writer_report"],["scenes","scene_plan"],["img-1","scene_visual_artifact"],["img-2","scene_visual_artifact"],["img-3","scene_visual_artifact"],["clip-1","scene_video_clip"],["clip-2","scene_video_clip"],["clip-3","scene_video_clip"],["voice","narration_artifact"],["final","final_media_artifact"],["final-qa","final_technical_qa"]];
  for(const [id,kind] of kinds)await persistence.saveArtifact(artifact(workflowId,`${contentId}-${id}`,kind));
  const technicalQa={technicalValidity:"PASS",aspectRatio:"PASS",resolution:"PASS",promptAdherence:"PASS",requirementCoverage:"PASS",corruptionFree:"PASS",brandFit:"PASS"};
  for(let i=1;i<=3;i++){const reviewed=await req(`/control/content/${contentId}/visual-reviews`,{method:"POST",body:JSON.stringify({artifactId:`${contentId}-img-${i}`,sceneId:`scene-${i}`,technicalQa,semanticQa:"HUMAN_REVIEW_REQUIRED",ownerAcceptance:"ACCEPTED",ownerFeedback:"Owner fixture acceptance"})});assert.equal(reviewed.status,200);assert.equal(reviewed.body.technicalQa,"PASS");}
  const revision=await req(`/control/content/${contentId}/revisions`,{method:"POST",body:JSON.stringify({layer:"IMAGE",targetArtifactId:`${contentId}-img-2`,previousArtifactId:`${contentId}-img-2`,ownerFeedback:"Scene 2 image does not fit the script",reason:"semantic mismatch"})});assert.equal(revision.status,201);assert.equal(revision.body.selective,true);assert.equal(revision.body.unrelatedLayersRegenerated,false);
  await persistence.saveArtifact(artifact(workflowId,`${contentId}-img-2-v2`,"scene_visual_artifact",{artifactId:`${contentId}-img-2`,kind:"scene_visual_artifact"}));
  const replacement=await req(`/control/content/${contentId}/visual-reviews`,{method:"POST",body:JSON.stringify({artifactId:`${contentId}-img-2-v2`,sceneId:"scene-2",technicalQa,semanticQa:"HUMAN_REVIEW_REQUIRED",ownerAcceptance:"ACCEPTED",ownerFeedback:"Replacement accepted"})});assert.equal(replacement.status,200);
  const approved=await req(`/control/content/${contentId}/final-approval`,{method:"POST",body:JSON.stringify({finalArtifactId:`${contentId}-final`,rationale:"Provider-free fixture passed final review"})});assert.equal(approved.status,200);
  const tooLong=await req(`/control/content/${contentId}/metadata`,{method:"POST",body:JSON.stringify({title:"x".repeat(101),description:"description",visibility:"private"})});assert.equal(tooLong.status,400);
  const metadata=await req(`/control/content/${contentId}/metadata`,{method:"POST",body:JSON.stringify({title:"Cairo in three details",description:"A grounded Morroway factual micro-story.",tags:["Morroway","Cairo"],visibility:"private"})});assert.equal(metadata.status,200);
  const prepared=await req(`/control/content/${contentId}/publication-preparations`,{method:"POST",body:"{}"});assert.equal(prepared.status,200);assert.equal(prepared.body.executed,false);assert.equal(prepared.body.providerRequest.privacyStatus,"private");assert.equal(prepared.body.bindingState,"BINDING_REQUIRED");
  const detail=await req(`/control/content/${contentId}`);assert.equal(detail.body.content.finalReviewStatus,"APPROVED");assert.equal(detail.body.revisions.length,1);assert.equal(detail.body.publicationPreparations.length,1);assert.equal(detail.body.visualReviews.length,4);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM capability_executions`)).rows[0].n,0);assert.equal((await pool.query(`SELECT coalesce(sum(used_count),0)::int n FROM automation_call_budgets WHERE project_id='morroway'`)).rows[0].n,0);assert.equal((await pool.query(`SELECT count(*)::int n FROM automation_policies WHERE project_id='morroway' AND enabled<>0`)).rows[0].n,0);
});

test("Cycle-01 preflight is capability-scoped, cycle-budgeted, and credential-neutral",async()=>{
  const phase="MORROWAY_PRODUCTION_CYCLE_01_PRE_MEDIA",now=new Date().toISOString();
  for(const [kind,limit] of [["research",4],["text_agent",10],["image_generation",1]])await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES('morroway',$1,$2,$3,0,0,0,TRUE,$4) ON CONFLICT(project_id,phase,call_kind) DO UPDATE SET limit_count=EXCLUDED.limit_count,reserved_count=0,consumed_count=0,max_retries=0,active=TRUE,updated_at=EXCLUDED.updated_at`,[phase,kind,limit,now]);
  const brief={topic:"Evidence-gated historical POV",objective:"One fresh Morroway Cycle-01 item",targetPlatform:"youtube",format:"short",targetAudience:"global curious adults",contentType:"historical_pov",language:"en",targetDurationSeconds:30,sceneTarget:1,researchRequirement:"required",characterRequirement:"none",identityCriticalHuman:false,productionCycle:"MORROWAY_PRODUCTION_CYCLE_01"};
  const created=await req("/control/content",{method:"POST",body:JSON.stringify({projectId:"morroway",title:"Cycle 01 preflight fixture",objective:brief.objective,topic:brief.topic,productionBrief:brief})});assert.equal(created.status,201);
  const result=await req(`/control/content/${created.body.content.contentId}/preflight`);assert.equal(result.status,200);assert.equal(result.body.preflight.ready,true);assert.equal(result.body.preflight.budgetPhase,phase);assert.deepEqual(result.body.preflight.callEnvelope,{research:4,text_agent:10,image_generation:1});assert.equal(result.body.preflight.youtubeCredentialRequired,false);assert.equal(result.body.preflight.providerCallsMade,0);
});
