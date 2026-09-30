/** Provider-agnostic visual routing contracts. Pure data and deterministic policy only. */

export const VISUAL_CONTENT_DOMAINS = [
  "PHOTOREAL_PEOPLE", "LIFESTYLE", "STREET_DOCUMENTARY", "TRAVEL_GENERIC", "LOCATION_SENSITIVE",
  "SPORTS", "WILDLIFE", "FOOD", "PRODUCT", "CINEMATIC", "CARTOON_2D", "STYLIZED_3D",
  "FANTASY", "BACKGROUND", "THUMBNAIL_BASE", "TEXT_IN_IMAGE",
] as const;
export type VisualContentDomain = typeof VISUAL_CONTENT_DOMAINS[number];

export const VISUAL_CAPABILITY_REQUIREMENTS = [
  "REFERENCE_EDIT", "CHARACTER_CONSISTENCY", "SUBJECT_IDENTITY", "COMPOSITION_PRESERVATION",
  "LOCATION_FIDELITY", "STYLE_PRESERVATION", "TEXT_RENDERING", "PEOPLE_ANATOMY", "COMMERCIAL_USE",
] as const;
export type VisualCapabilityRequirement = typeof VISUAL_CAPABILITY_REQUIREMENTS[number];

export const VISUAL_EXECUTION_ROUTES = [
  "AUTOMATIC_LOW_COST", "PREMIUM_API", "MANUAL_EXTERNAL_GENERATION", "REAL_OR_LICENSED_MEDIA",
] as const;
export type VisualExecutionRoute = typeof VISUAL_EXECUTION_ROUTES[number];

export type EvidenceVerdict = "PASS" | "FAIL" | "UNKNOWN" | "UNBENCHMARKED";
export type ReviewVerdict = "HUMAN_PASS" | "HUMAN_FAIL" | "HUMAN_REVIEW_REQUIRED" | "NOT_REVIEWED";

export interface ProviderCapabilityProfile {
  provider: string;
  model: string;
  route: VisualExecutionRoute;
  domains: readonly VisualContentDomain[];
  capabilities: Readonly<Partial<Record<VisualCapabilityRequirement, EvidenceVerdict>>>;
  qualityScore?: number;
  humanVerdict: ReviewVerdict;
  automatedVerdict: EvidenceVerdict;
  estimatedCostUsd?: number;
  estimatedLatencyMs?: number;
  commercialEligible: EvidenceVerdict;
  supportedResolutions?: readonly string[];
  evidenceSource: string;
  benchmarkVersion: string;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  lastEvaluatedAt?: string;
}

export interface VisualRoutingRequest {
  task: VisualContentDomain;
  requirements: readonly VisualCapabilityRequirement[];
  minimumQualityScore?: number;
  requireCommercialEligibility?: boolean;
  preferredRoutes?: readonly VisualExecutionRoute[];
  humanInterventionAvailable?: boolean;
  realMediaAvailable?: boolean;
}

export interface VisualRoutingDecision {
  task: VisualContentDomain;
  requirements: readonly VisualCapabilityRequirement[];
  route: VisualExecutionRoute;
  provider?: string;
  model?: string;
  reason: string;
  evidence: readonly string[];
}

function satisfies(profile: ProviderCapabilityProfile, request: VisualRoutingRequest): boolean {
  if (profile.humanVerdict !== "HUMAN_PASS") return false;
  if (profile.automatedVerdict === "FAIL") return false;
  if (profile.commercialEligible === "FAIL" || (request.requireCommercialEligibility && profile.commercialEligible !== "PASS")) return false;
  if (profile.qualityScore === undefined || (request.minimumQualityScore !== undefined && profile.qualityScore < request.minimumQualityScore)) return false;
  return request.requirements.every((requirement) => profile.capabilities[requirement] === "PASS")
    && (profile.domains.includes(request.task) || profile.domains.length === 0);
}

/** Hard requirements and evidence decide eligibility; cost/latency only break ties. */
export function selectVisualRoute(request: VisualRoutingRequest, profiles: readonly ProviderCapabilityProfile[]): VisualRoutingDecision {
  const eligible = profiles.filter((profile) => profile.route === "AUTOMATIC_LOW_COST" && satisfies(profile, request));
  if (eligible.length > 0) {
    const selected = [...eligible].sort((a, b) => (a.estimatedCostUsd ?? Number.POSITIVE_INFINITY) - (b.estimatedCostUsd ?? Number.POSITIVE_INFINITY)
      || (a.estimatedLatencyMs ?? Number.POSITIVE_INFINITY) - (b.estimatedLatencyMs ?? Number.POSITIVE_INFINITY))[0];
    return { task: request.task, requirements: request.requirements, route: selected.route, provider: selected.provider, model: selected.model, reason: "Meets hard requirements and human-approved evidence with the lowest configured expected cost.", evidence: [selected.evidenceSource] };
  }
  const preferred = request.preferredRoutes ?? ["PREMIUM_API", "MANUAL_EXTERNAL_GENERATION", "REAL_OR_LICENSED_MEDIA"];
  for (const route of preferred) {
    if (route === "PREMIUM_API" && profiles.some((profile) => profile.route === route && satisfies(profile, request))) {
      const profile = profiles.find((candidate) => candidate.route === route && satisfies(candidate, request))!;
      return { task: request.task, requirements: request.requirements, route, provider: profile.provider, model: profile.model, reason: "No approved low-cost provider satisfies the hard requirements; eligible premium evidence is available.", evidence: [profile.evidenceSource] };
    }
    if (route === "MANUAL_EXTERNAL_GENERATION" && request.humanInterventionAvailable) return { task: request.task, requirements: request.requirements, route, reason: "No approved automatic provider satisfies the hard requirements; human generation is available.", evidence: [] };
    if (route === "REAL_OR_LICENSED_MEDIA" && request.realMediaAvailable) return { task: request.task, requirements: request.requirements, route, reason: "No approved automatic provider satisfies the hard requirements; real/licensed media is available.", evidence: [] };
  }
  return { task: request.task, requirements: request.requirements, route: "MANUAL_EXTERNAL_GENERATION", reason: "No evidenced automatic route is eligible; fail closed and require an explicit human or real-media decision.", evidence: [] };
}

export const MANUAL_EXTERNAL_GENERATION_STATES = ["PENDING_HUMAN_GENERATION", "ASSET_RECEIVED", "REVIEW_REQUIRED", "QA_REQUIRED", "HUMAN_APPROVAL_REQUIRED", "APPROVED", "REJECTED", "READY_FOR_DOWNSTREAM_VIDEO"] as const;
export type ManualExternalGenerationState = typeof MANUAL_EXTERNAL_GENERATION_STATES[number];

export interface ManualExternalGenerationRequest {
  requestId: string;
  projectId: string;
  contentId: string;
  sceneId?: string;
  domain: VisualContentDomain;
  recommendedCapabilityCategory?: string;
  prompt: string;
  negativeConstraints: readonly string[];
  referenceAssets: readonly string[];
  referenceDescriptions: readonly string[];
  aspectRatio: string;
  targetDimensions: { width: number; height: number };
  purpose: string;
  acceptanceCriteria: readonly string[];
  preservationConstraints: readonly string[];
  outputInbox: string;
  status: ManualExternalGenerationState;
  externalTool?: string;
  providerCostUsd?: number;
  humanInterventionRequired?: boolean;
  automationLevel?: "MANUAL" | "ASSISTED";
  costClassification?: "MANUAL_EXTERNAL_ZERO_PROVIDER_COST" | "UNKNOWN";
  generationMethod?: "HUMAN_MANUAL";
  createdAt?: string;
  rightsStatus?: "UNKNOWN" | "USER_CONFIRMED" | "RESTRICTED" | "NOT_APPLICABLE";
  commercialRightsStatus?: "UNKNOWN" | "USER_CONFIRMED" | "RESTRICTED" | "NOT_APPLICABLE";
}

export interface HumanAssetProvenance {
  sourceType: "MANUAL_EXTERNAL_GENERATION";
  provider?: string;
  model?: string;
  createdBy: "HUMAN";
  requestId: string;
  referenceAssets: readonly string[];
  approvalStatus: ManualExternalGenerationState;
  sha256: string;
  dimensions: { width: number; height: number };
  ingestedAt: string;
  originalFilename?: string;
  ingestedAssetPath?: string;
  mimeType?: string;
  aspectRatio?: string;
  receivedAt?: string;
  externalTool?: string;
  providerCostUsd?: number;
  humanInterventionRequired?: boolean;
  rightsStatus?: "UNKNOWN" | "USER_CONFIRMED" | "RESTRICTED" | "NOT_APPLICABLE";
}

const transitions: Readonly<Record<ManualExternalGenerationState, readonly ManualExternalGenerationState[]>> = {
  PENDING_HUMAN_GENERATION: ["ASSET_RECEIVED"], ASSET_RECEIVED: ["REVIEW_REQUIRED"], REVIEW_REQUIRED: ["QA_REQUIRED", "REJECTED"],
  QA_REQUIRED: ["HUMAN_APPROVAL_REQUIRED", "REJECTED"], HUMAN_APPROVAL_REQUIRED: ["APPROVED", "REJECTED"], APPROVED: ["READY_FOR_DOWNSTREAM_VIDEO"], REJECTED: [], READY_FOR_DOWNSTREAM_VIDEO: [],
};
export function canAdvanceManualGeneration(from: ManualExternalGenerationState, to: ManualExternalGenerationState): boolean { return transitions[from].includes(to); }

export const VISUAL_REVIEW_ORDER = ["REVIEWER", "QA", "HUMAN_GATE"] as const;
export const AUTOMATED_SEMANTIC_REVIEW_UNAVAILABLE = "HUMAN_REVIEW_REQUIRED" as const;

export interface RoutingBenchmarkCase {
  benchmarkId: string;
  domain: VisualContentDomain;
  capabilityRequirements: readonly VisualCapabilityRequirement[];
  prompt: string;
  aspectRatio: string;
  targetResolution: string;
  acceptanceCriteria: readonly string[];
  providers: readonly string[];
  maxCallsPerProvider: number;
  humanReviewRubric: readonly string[];
}

export const VISUAL_PROVIDER_ROUTING_BENCHMARK_V1: readonly RoutingBenchmarkCase[] = [
  ["photoreal_people", "PHOTOREAL_PEOPLE", "A documentary-style portrait of a contemporary person walking through a sunlit public market, natural expression, realistic clothing and anatomy.", ["PEOPLE_ANATOMY"]],
  ["lifestyle", "LIFESTYLE", "A candid contemporary lifestyle scene in a bright neighborhood cafe, natural human interaction, believable materials and daylight.", []],
  ["sports", "SPORTS", "A realistic football player making a decisive pass during a live match, coherent body pose, ball and stadium context, no readable text.", ["PEOPLE_ANATOMY"]],
  ["cinematic", "CINEMATIC", "A cinematic dusk street scene after light rain, expressive practical lighting, believable reflections, one coherent composition.", []],
  ["wildlife", "WILDLIFE", "A detailed wildlife photograph of an elephant family crossing a shallow river at golden hour, natural anatomy and environment.", []],
  ["product", "PRODUCT", "A studio product photograph of a matte ceramic travel mug on a clean surface, accurate material, controlled soft light, no logo or text.", []],
  ["cartoon_2d", "CARTOON_2D", "A polished 2D cartoon illustration of a curious fox exploring a colorful woodland path, consistent shapes, expressive pose, no text.", []],
  ["stylized_3d", "STYLIZED_3D", "A high-quality stylized 3D render of a small robot gardener in a greenhouse, coherent geometry, soft cinematic light, no text.", []],
].map(([id, domain, prompt, requirements]) => ({ benchmarkId: id as string, domain: domain as VisualContentDomain, capabilityRequirements: requirements as VisualCapabilityRequirement[], prompt: prompt as string, aspectRatio: "1:1", targetResolution: "1024x1024", acceptanceCriteria: ["semantic prompt adherence", "single coherent image", "no material artifacts"], providers: ["runpod-zimage", "self-hosted-image"], maxCallsPerProvider: 1, humanReviewRubric: ["PROMPT_ADHERENCE 1-10", "VISUAL_QUALITY 1-10", "DOMAIN_FIT 1-10", "PRODUCTION_READINESS 1-10"] }));
