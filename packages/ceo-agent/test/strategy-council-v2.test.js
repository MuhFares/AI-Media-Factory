import { deepStrictEqual, doesNotThrow, match, ok, throws } from "node:assert";
import { describe, it } from "node:test";
import { diagnoseStrategyCouncilSynthesisV2, validateStrategyCouncilSynthesisV2, validateStrategyCouncilV2Manifest, StrategyCouncilV2StructuralError, STRATEGY_COUNCIL_V2_EXAMPLE, STRATEGY_COUNCIL_V2_OUTPUT_INSTRUCTIONS, STRATEGY_COUNCIL_V2_RESPONSE_SCHEMA, STRATEGY_COUNCIL_V2_SYSTEM_PROMPT } from "../dist/index.js";

const words = (label) => `${label} is evidence-grounded and remains subject to owner review`;
function valid() {
  return {
    contract:"STRATEGY_COUNCIL_SYNTHESIS_V2",status:"AWAITING_OWNER_APPROVAL",
    executiveSummary:{recommendation:words("recommendation"),tradeoffs:[words("tradeoff")],launchDecision:words("launch"),ownerDecisions:[words("approval")],deferredDecisions:[words("deferred")]},
    strategicRecommendation:{territory:words("territory"),rationale:words("rationale"),targetAudience:words("audience"),audiencePromise:words("promise"),differentiation:words("difference"),flagshipProposition:words("proposition")},
    contentSystem:{primaryPillars:[words("pillar")],deferredPillars:[words("later pillar")],formats:[words("format")],flagshipFormat:words("flagship"),productionModel:words("production")},
    platforms:["Instagram Reels","YouTube Shorts","TikTok"].map((platform,priority)=>({platform,role:words("role"),priority:priority+1,launchTiming:words("timing"),reuseApproach:words("reuse"),rationale:words("platform rationale")})),
    identity:{recommendation:"HYBRID",rationale:words("identity")},channelPortfolio:{recommendation:"PHASED_PORTFOLIO",launchArchitecture:words("architecture"),launchesFirst:words("first"),deferred:[words("deferred channel")],expansionTrigger:words("trigger"),rationale:words("portfolio")},
    monetization:{initialRoutes:[words("initial route")],laterRoutes:[words("later route")],dependencies:[words("dependency")],assumptions:[words("assumption")],risks:[words("monetization risk")]},
    costAndReinvestment:{startingModel:words("lean model"),requiredPaidComponents:[words("paid")],lowCostComponents:[words("low cost")],reinvestmentPriorities:[words("reinvestment")],costControlGates:[words("gate")],unknownCosts:["UNKNOWN provider pricing pending verification"]},
    revenueMilestones:[100,1000,10000].map(monthlyUsd=>({monthlyUsd,objective:words("objective"),mechanism:words("mechanism"),operationalRequirement:words("operation"),scaleTrigger:words("scale"),majorRisk:words("risk")})),
    productionFeasibility:{difficulty:words("difficulty"),workflowComplexity:words("complexity"),aiDependency:words("AI dependency"),humanReview:words("human review"),scalabilityConstraints:[words("constraint")]},
    videoConcepts:Array.from({length:10},(_,i)=>({concept:`Concept ${i+1} grounded in evidence`,pillar:words("pillar"),hook:words("hook"),platformFit:["TikTok"],rationale:words("concept rationale")})),
    risks:["platform","saturation/content","production","monetization","copyright/reference-use","cost","operational"].map(category=>({category,impact:words("impact"),mitigation:words("mitigation")})),
    evidenceNotes:[{label:words("evidence"),classification:"INFERRED",rationale:words("evidence rationale")}],disagreements:[{specialists:["writer","seo"],positions:[words("position one"),words("position two")],resolution:words("resolution"),rationale:words("resolution rationale")}],namingCriteria:["Must be memorable and globally comprehensible"]
  };
}
const manifest=()=>["research","planner","writer","seo","brand","growth","finance"].map(producerAgent=>({artifactId:`a-${producerAgent}`,producerAgent,workflowId:"wf",correlationId:"corr",status:"completed",kind:`${producerAgent}_report`}));

describe("StrategyCouncilSynthesisV2 hardening",()=>{
 it("accepts a complete owner-review synthesis and aligned nonempty prompt",()=>{ok(STRATEGY_COUNCIL_V2_SYSTEM_PROMPT.length>100);deepStrictEqual(validateStrategyCouncilSynthesisV2(STRATEGY_COUNCIL_V2_EXAMPLE),STRATEGY_COUNCIL_V2_EXAMPLE);deepStrictEqual(validateStrategyCouncilSynthesisV2(valid()),valid());for(const field of Object.keys(valid())){ok(STRATEGY_COUNCIL_V2_OUTPUT_INSTRUCTIONS.includes(field)||["contract","status"].includes(field));ok(STRATEGY_COUNCIL_V2_RESPONSE_SCHEMA.properties[field]);}});
 it("rejects missing sections, nested fields, and wrong types with bounded value-free diagnostics",()=>{for(const mutate of [v=>delete v.monetization,v=>delete v.identity.rationale,v=>v.executiveSummary=[],v=>v.platforms[0].priority="one"]){const v=valid();mutate(v);throws(()=>validateStrategyCouncilSynthesisV2(v),StrategyCouncilV2StructuralError);}const secret="DO_NOT_PERSIST_SECRET_PROSE";const d=diagnoseStrategyCouncilSynthesisV2({...valid(),platforms:secret});ok(d.issues.length>0);ok(JSON.stringify(d).length<6000);ok(!JSON.stringify(d).includes(secret));});
 it("enforces enums and exact counts",()=>{for(const mutate of [v=>v.identity.recommendation="OTHER",v=>v.channelPortfolio.recommendation="OTHER",v=>v.platforms.pop(),v=>v.revenueMilestones.pop(),v=>v.videoConcepts.pop()]){const v=valid();mutate(v);throws(()=>validateStrategyCouncilSynthesisV2(v),StrategyCouncilV2StructuralError);}});
 it("separates structural and semantic failures",()=>{const v=valid();v.videoConcepts[1].concept=v.videoConcepts[0].concept;throws(()=>validateStrategyCouncilSynthesisV2(v),/SEMANTIC_VALIDATION_FAILED/);const named=valid();named.namingCriteria=["Final name: Viral Forge"];throws(()=>validateStrategyCouncilSynthesisV2(named),/naming/);const guaranteed=valid();guaranteed.monetization.assumptions=["guaranteed revenue"];throws(()=>validateStrategyCouncilSynthesisV2(guaranteed),/guaranteed revenue/);});
 it("enforces the exact completed same-run seven-specialist manifest without payload inspection",()=>{doesNotThrow(()=>validateStrategyCouncilV2Manifest(manifest(),"wf","corr"));for(const mutate of [v=>v.pop(),v=>v[0].producerAgent="writer",v=>v[0].status="failed",v=>v[0].workflowId="other",v=>v[0].correlationId="other"]){const v=manifest();mutate(v);throws(()=>validateStrategyCouncilV2Manifest(v,"wf","corr"),StrategyCouncilV2StructuralError);}});
});
