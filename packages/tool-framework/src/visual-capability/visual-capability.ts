export const VISUAL_MODES = [
  "photoreal_documentary",
  "travel/location",
  "sports/action",
  "cinematic/editorial",
  "stylized_cartoon/illustration",
] as const;
export type VisualMode = typeof VISUAL_MODES[number];

export const REFERENCE_STRATEGIES = [
  "NO_REFERENCE",
  "WEB_VISUAL_RESEARCH",
  "STYLE_REFERENCE",
  "LOCATION_REFERENCE",
  "PERSON_REFERENCE",
  "CHARACTER_REFERENCE",
  "SCENE_REFERENCE",
  "MULTI_REFERENCE",
] as const;
export type ReferenceStrategy = typeof REFERENCE_STRATEGIES[number];

export interface VisualEvidence {
  id: string;
  kind: "image" | "source";
  uri: string;
  sourceUrl?: string;
  provenance: "user_owned" | "local" | "web" | "provider" | "unknown";
  sha256?: string;
  observations: string[];
  relevance: string;
}

export interface VisualResearchResult {
  topic: string;
  visualMode: VisualMode;
  referenceStrategy: ReferenceStrategy;
  imageRefs: VisualEvidence[];
  sourceRefs: VisualEvidence[];
  observations: string[];
  people?: { description: string; wardrobe?: string[] }[];
  environment?: string[];
  location?: string[];
  objects?: string[];
  styleCues?: string[];
  avoidCues?: string[];
  sceneRelevance?: string;
  provenance: "none" | "local" | "web" | "mixed";
}

export function isVisualResearchResult(value: unknown): value is VisualResearchResult {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.topic === "string" && typeof v.visualMode === "string" && (VISUAL_MODES as readonly string[]).includes(v.visualMode)
    && typeof v.referenceStrategy === "string" && (REFERENCE_STRATEGIES as readonly string[]).includes(v.referenceStrategy)
    && Array.isArray(v.imageRefs) && Array.isArray(v.sourceRefs) && Array.isArray(v.observations)
    && ["none", "local", "web", "mixed"].includes(String(v.provenance));
}

export interface VisualStrategy {
  visualMode: VisualMode;
  referenceStrategy: ReferenceStrategy;
  rationale: string;
  imageBrief: string;
  negativeBrief: string;
}

export function createVisualStrategy(input: Pick<VisualResearchResult, "visualMode" | "referenceStrategy" | "topic"> & Partial<Pick<VisualResearchResult, "observations" | "avoidCues">>): VisualStrategy {
  const observations = input.observations?.filter(Boolean).join("; ") ?? "";
  const avoid = input.avoidCues?.filter(Boolean).join(", ") ?? "text, collage, grid, duplicated subjects, malformed anatomy";
  return {
    visualMode: input.visualMode,
    referenceStrategy: input.referenceStrategy,
    rationale: `Selected ${input.visualMode} for ${input.topic}; reference policy is ${input.referenceStrategy}.`,
    imageBrief: [input.topic, observations].filter(Boolean).join(". "),
    negativeBrief: avoid,
  };
}

export interface ImageReviewInput {
  hasMultimodalRuntime: boolean;
  semanticAlignment?: boolean;
  subjectLocationStyleFidelity?: boolean;
  genericOrStereotypeDrift?: boolean;
  sceneIntent?: boolean;
  referenceAdherence?: boolean;
}

export interface ImageQAInput {
  hasMultimodalRuntime: boolean;
  generatedText?: "none" | "gibberish" | "readable";
  collageOrGrid?: boolean;
  anatomy?: "clean" | "defect";
  duplication?: boolean;
  geometry?: "clean" | "defect";
  blurOrArtifacts?: boolean;
  dimensionsValid?: boolean;
  fileIntegrityValid?: boolean;
}

export interface ImageGateResult {
  status: "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED";
  canEnterWan: false | true;
  reason: string;
  reviewer: "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED";
  qa: "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED";
}

export function evaluateImageGate(review: ImageReviewInput, qa: ImageQAInput): ImageGateResult {
  if (!review.hasMultimodalRuntime || !qa.hasMultimodalRuntime) return { status: "HUMAN_REVIEW_REQUIRED", canEnterWan: false, reason: "No multimodal runtime evidence; fail closed.", reviewer: "HUMAN_REVIEW_REQUIRED", qa: "HUMAN_REVIEW_REQUIRED" };
  const reviewFail = review.semanticAlignment === false || review.subjectLocationStyleFidelity === false || review.genericOrStereotypeDrift === true || review.sceneIntent === false || review.referenceAdherence === false;
  const qaFail = qa.generatedText === "readable" || qa.generatedText === "gibberish" || qa.collageOrGrid === true || qa.anatomy === "defect" || qa.duplication === true || qa.geometry === "defect" || qa.blurOrArtifacts === true || qa.dimensionsValid === false || qa.fileIntegrityValid === false;
  const reviewer = reviewFail ? "FAIL" : "PASS";
  const qaStatus = qaFail ? "FAIL" : "PASS";
  if (reviewFail || qaFail) return { status: "FAIL", canEnterWan: false, reason: reviewFail ? "Reviewer rejected semantic/visual fidelity." : "QA rejected image integrity or visible defects.", reviewer, qa: qaStatus };
  return { status: "PASS", canEnterWan: true, reason: "Reviewer and QA supplied multimodal evidence and passed.", reviewer, qa: qaStatus };
}
