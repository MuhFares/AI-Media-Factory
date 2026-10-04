export type ProductionCapabilityStage =
  | "RESEARCH" | "CEO" | "BRIEF" | "WRITER" | "SCENES" | "VISUAL_DIRECTION"
  | "IMAGE_GENERATION" | "WAN" | "YOUTUBE_PUBLICATION" | "YOUTUBE_ANALYTICS";

export interface CapabilityReadinessInput {
  stage: ProductionCapabilityStage;
  projectActive: boolean;
  projectAuthorized: boolean;
  workerHealthy: boolean;
  routingHealthy: boolean;
  providerCapabilityHealthy: boolean;
  budgetAvailable: boolean;
  youtubeCredentialFresh: boolean;
  wanGovernanceReady?: boolean;
}

export const YOUTUBE_CREDENTIAL_DEPENDENCY: Readonly<Record<ProductionCapabilityStage, boolean>> = {
  RESEARCH:false,CEO:false,BRIEF:false,WRITER:false,SCENES:false,VISUAL_DIRECTION:false,
  IMAGE_GENERATION:false,WAN:false,YOUTUBE_PUBLICATION:true,YOUTUBE_ANALYTICS:true,
};

/** Provider-free, capability-scoped readiness. Unrelated channel credentials
 * can never block content/media capabilities, while publication and YouTube
 * analytics keep their fail-closed credential boundary. */
export function evaluateCapabilityReadiness(input: CapabilityReadinessInput) {
  const failures:string[]=[];
  if(!input.projectActive)failures.push("PROJECT_INACTIVE");
  if(!input.projectAuthorized)failures.push("PROJECT_ACCESS_DENIED");
  if(!input.workerHealthy)failures.push("WORKER_UNHEALTHY");
  const youtubeDependent=YOUTUBE_CREDENTIAL_DEPENDENCY[input.stage];
  if(youtubeDependent&&!input.youtubeCredentialFresh)failures.push("YOUTUBE_CREDENTIAL_REFRESH_REQUIRED");
  if(!youtubeDependent){
    if(input.stage!=="WAN"&&!input.routingHealthy)failures.push("ROUTING_UNHEALTHY");
    if(!input.providerCapabilityHealthy)failures.push("PROVIDER_CAPABILITY_UNHEALTHY");
    if(!input.budgetAvailable)failures.push("CAPABILITY_BUDGET_UNAVAILABLE");
  }
  if(input.stage==="WAN"&&input.wanGovernanceReady!==true)failures.push("WAN_GOVERNANCE_NOT_READY");
  return{stage:input.stage,ready:failures.length===0,youtubeCredentialRequired:youtubeDependent,failures};
}
