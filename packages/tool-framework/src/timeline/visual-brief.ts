/**
 * Deterministic scene-level visual direction and pre-Wan safety gates.
 * This module intentionally has no network, OCR, image-generation, or video
 * dependencies. It makes missing local visual inspection capability explicit.
 */

export interface CairoVisualGrounding {
  location: string;
  architecture: string;
  storefronts: string;
  streetMorphology: string;
  transportation: string;
  marketStructure: string;
  materialsAndColors: string;
  signage: string;
  wardrobe: string;
  density: string;
  lighting: string;
  streetFurniture: string;
  vehicleMix: string;
}

export const CONTEMPORARY_CAIRO_GROUNDING: CairoVisualGrounding = {
  location: "contemporary Cairo, Egypt; an ordinary lived-in neighborhood rather than a generic Middle Eastern setting",
  architecture: "mid-rise concrete residential buildings, balconies, shaded shopfronts, mixed old-and-new facades",
  storefronts: "small street-facing Egyptian shops and practical awnings, with signs present only as non-legible shapes",
  streetMorphology: "dense narrow sidewalks and active street edges with believable pedestrian flow",
  transportation: "ordinary Cairo traffic context, bicycles and motorcycles only when the narration calls for them",
  marketStructure: "small sidewalk commerce, vendor tables, compact stalls, and practical goods arranged at street level",
  materialsAndColors: "dusty concrete, plaster, metal shutters, wood, faded paint, warm sun, and natural urban color",
  signage: "ambient storefront signs allowed compositionally but never readable, generated, or foregrounded",
  wardrobe: "contemporary Egyptian everyday clothing; no Gulf thobes, keffiyeh styling, or pan-Arab costume shorthand",
  density: "lively but natural Cairo density; no staged crowd and no empty studio-like street",
  lighting: "natural Cairo daylight or warm late-afternoon light, documentary realism",
  streetFurniture: "ordinary tables, stools, awnings, utility poles, parked scooters, and curb details only when scene-relevant",
  vehicleMix: "believable local street vehicle mix without hero-car framing or invented branding",
};

export interface SceneVisualBrief {
  sceneId: string;
  narrationSegment: string;
  semanticSubject: string;
  primaryAction: string;
  location: string;
  environment: string;
  people: string;
  wardrobe: string;
  objects: string[];
  transport: string;
  architecture: string;
  timeOfDay: string;
  lighting: string;
  cameraLanguage: string;
  composition: string;
  motionIntent: string;
  cairoGroundingCues: string[];
  requiredElements: string[];
  forbiddenElements: string[];
  textPolicy: string;
  singleShotRequirement: string;
}

export const TEXT_FREE_IMAGE_POLICY = "No intentional readable letters, words, captions, subtitles, logos, watermarks, UI text, numbers, or foreground signage; natural background signs may exist only as non-legible shapes.";
export const SINGLE_SHOT_POLICY = "one coherent cinematic composition, one continuous shot, no split screen, no collage, no grid, no contact sheet, no duplicated panels";

const COMMON_FORBIDDEN = [
  "computer", "laptop", "desktop monitor", "office desk", "workspace", "remote work",
  "futuristic interface", "hologram", "corporate office", "Gulf thobe", "keffiyeh costume",
  "split screen", "collage", "grid", "multiple panels", "readable text", "caption", "subtitle", "watermark",
];

function cairoEnabled(visualStyle: string | undefined, culturalContext: string | undefined): boolean {
  const value = `${visualStyle ?? ""} ${culturalContext ?? ""}`.toLowerCase();
  return /cairo|القاهرة|egypt|egyptian|مصر|مصري/u.test(value);
}

function cairoBrief(sceneId: string, segment: string, index: number, total: number): SceneVisualBrief {
  const lower = segment.toLowerCase();
  const hasMarket = /سوق|أسواق|محلات|رصيف|باعة/u.test(segment);
  const hasTransport = /عجل|موتوسيكلات|دراج|مواصلات/u.test(segment);
  const hasLandmark = /معالم|شهيرة/u.test(segment);
  const isCta = index === total - 1;
  const semanticSubject = hasMarket ? "Cairo neighborhood street commerce" : hasTransport ? "Cairo street movement" : hasLandmark ? "ordinary Cairo life beyond tourist landmarks" : isCta ? "observational Cairo street detail" : "lived-in Cairo neighborhood street";
  const primaryAction = hasMarket ? "vendors and shoppers naturally using small sidewalk shops" : hasTransport ? "bicycles and motorcycles moving naturally through the street" : isCta ? "the camera observes a small everyday street detail" : "pedestrians move through a familiar neighborhood street";
  const required = hasMarket ? ["small sidewalk shops", "ordinary Egyptian vendors", "street-level market activity"] : hasTransport ? ["bicycles or motorcycles", "ordinary Cairo street flow"] : ["believable Cairo residential street", "natural Egyptian daily life"];
  if (hasLandmark) required.push("a distant or partial landmark context only if naturally present, never a tourism postcard");
  return {
    sceneId,
    narrationSegment: segment,
    semanticSubject,
    primaryAction,
    location: CONTEMPORARY_CAIRO_GROUNDING.location,
    environment: hasMarket ? CONTEMPORARY_CAIRO_GROUNDING.marketStructure : CONTEMPORARY_CAIRO_GROUNDING.streetMorphology,
    people: "ordinary Egyptian residents and vendors, naturally observed, no presenter and no posed hero portrait",
    wardrobe: CONTEMPORARY_CAIRO_GROUNDING.wardrobe,
    objects: hasMarket ? ["vendor table", "compact shop goods", "awning", "stool"] : ["shop shutters", "balconies", "curb details"],
    transport: hasTransport ? CONTEMPORARY_CAIRO_GROUNDING.transportation : "no transport emphasis unless visible naturally in the segment",
    architecture: CONTEMPORARY_CAIRO_GROUNDING.architecture,
    timeOfDay: "late afternoon or clear natural daylight",
    lighting: CONTEMPORARY_CAIRO_GROUNDING.lighting,
    cameraLanguage: "street-level documentary wide or medium shot with natural depth and restrained handheld stability",
    composition: SINGLE_SHOT_POLICY,
    motionIntent: hasTransport ? "gentle tracking with natural passing movement" : "subtle observational camera drift with ordinary human motion",
    cairoGroundingCues: [CONTEMPORARY_CAIRO_GROUNDING.materialsAndColors, CONTEMPORARY_CAIRO_GROUNDING.storefronts, CONTEMPORARY_CAIRO_GROUNDING.density],
    requiredElements: required,
    forbiddenElements: COMMON_FORBIDDEN,
    textPolicy: TEXT_FREE_IMAGE_POLICY,
    singleShotRequirement: SINGLE_SHOT_POLICY,
  };
}

export function buildSceneVisualBrief(sceneId: string, segment: string, index: number, total: number, visualStyle?: string, culturalContext?: string): SceneVisualBrief | undefined {
  return cairoEnabled(visualStyle, culturalContext) ? cairoBrief(sceneId, segment, index, total) : undefined;
}

export function buildBriefImagePrompt(brief: SceneVisualBrief): string {
  return [
    brief.semanticSubject,
    `action: ${brief.primaryAction}`,
    `location: ${brief.location}`,
    `environment: ${brief.environment}`,
    `people: ${brief.people}`,
    `wardrobe: ${brief.wardrobe}`,
    `objects: ${brief.objects.join(", ")}`,
    `architecture: ${brief.architecture}`,
    `transport: ${brief.transport}`,
    `camera: ${brief.cameraLanguage}`,
    `composition: ${brief.composition}`,
    `lighting: ${brief.lighting}`,
    `Cairo cues: ${brief.cairoGroundingCues.join("; ")}`,
    `required: ${brief.requiredElements.join(", ")}`,
    brief.textPolicy,
    `narration alignment: "${brief.narrationSegment.replaceAll("\"", "")}"`,
  ].join("; ");
}

export function buildBriefNegativePrompt(brief: SceneVisualBrief): string {
  return `${brief.forbiddenElements.join(", ")}, distorted hands, blurry, low quality, artificial duplicated subjects, ${brief.textPolicy}`;
}

export type PreWanGateStatus = "PASS" | "BLOCKED" | "HUMAN_REVIEW_REQUIRED";
export interface PreWanImageSignals {
  textArtifactScore?: number;
  collageScore?: number;
  duplicatedSubjectScore?: number;
}
export interface PreWanImageGateResult {
  status: PreWanGateStatus;
  ocr: "UNAVAILABLE_LOCAL_ONLY";
  collageDetection: "UNAVAILABLE_LOCAL_ONLY" | "SIGNAL_EVALUATED";
  reasons: string[];
  canEnterWan: boolean;
}

export function evaluatePreWanImage(signals?: PreWanImageSignals): PreWanImageGateResult {
  const reasons: string[] = [];
  if ((signals?.textArtifactScore ?? 0) >= 0.5) reasons.push("material generated text artifact signal");
  if ((signals?.collageScore ?? 0) >= 0.5) reasons.push("material collage/grid signal");
  if ((signals?.duplicatedSubjectScore ?? 0) >= 0.5) reasons.push("duplicated major subject signal");
  if (reasons.length > 0) return { status: "BLOCKED", ocr: "UNAVAILABLE_LOCAL_ONLY", collageDetection: "SIGNAL_EVALUATED", reasons, canEnterWan: false };
  return {
    status: "HUMAN_REVIEW_REQUIRED",
    ocr: "UNAVAILABLE_LOCAL_ONLY",
    collageDetection: signals ? "SIGNAL_EVALUATED" : "UNAVAILABLE_LOCAL_ONLY",
    reasons: ["no reliable local OCR/image-layout detector is installed; human visual inspection is required before Wan"],
    canEnterWan: false,
  };
}

export function validateSceneVisualBrief(brief: SceneVisualBrief): string[] {
  const errors: string[] = [];
  if (!brief.narrationSegment.trim()) errors.push("narration segment is empty");
  if (!brief.semanticSubject.trim() || !brief.primaryAction.trim()) errors.push("semantic subject/action is missing");
  if (!brief.singleShotRequirement.includes("one coherent")) errors.push("single-shot policy is missing");
  if (!brief.textPolicy.includes("No intentional readable")) errors.push("text-free policy is missing");
  if (brief.forbiddenElements.includes("Gulf thobe") === false) errors.push("Gulf wardrobe prohibition is missing");
  if (brief.forbiddenElements.includes("computer") === false) errors.push("technology contamination prohibition is missing");
  return errors;
}
