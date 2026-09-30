/**
 * VISUAL DIRECTOR — governed business-agent definition (design/registration).
 *
 * Senior Cinematic Visual Director / Art Director. Distinct from deterministic
 * contract validation and compilation: this role INTERPRETS approved story +
 * brand + prior visual-failure evidence and AUTHORS a VisualDirectionContractV2.
 * It must NOT generate images, select providers silently, approve its own
 * work, override owner decisions, change the approved script, invent factual
 * historical claims, or invent unsupported human identity (age, nationality,
 * ethnicity, gender).
 *
 * Execution requires a future explicitly-authorized creative runtime. This
 * module only DEFINES the role and builds its governed input package
 * (pure, provider-free). Nothing here contacts any provider or model.
 */

export const VISUAL_DIRECTOR_AGENT_ID = "visual-director" as const;

export const VISUAL_DIRECTOR_ROLE = "Senior Cinematic Visual Director / Art Director" as const;

export const VISUAL_DIRECTOR_RESPONSIBILITIES: readonly string[] = [
  "interpret the approved story without literal narration-to-image translation",
  "establish one coherent visual world (identity, era, material/color/lighting/camera language)",
  "choose whether recurring visible characters are required; prefer non-identifying grammar (hands, silhouette, over-shoulder, desk, manuscripts) when identity cannot be sustained",
  "create per-scene visual storytelling with real subjects, actions, and compositions",
  "maintain style, world, and character continuity across every scene",
  "obey Morroway brand identity (Threshold territory; restrained palette as cinematic language)",
  "obey text/UI policy (default FORBIDDEN/FORBIDDEN)",
  "emit provider-neutral VisualDirectionContractV2 for deterministic validation",
];

export const VISUAL_DIRECTOR_CONSTRAINTS: readonly string[] = [
  "MUST_NOT_GENERATE_IMAGES",
  "MUST_NOT_SELECT_PROVIDERS_SILENTLY",
  "MUST_NOT_APPROVE_OWN_WORK",
  "MUST_NOT_OVERRIDE_OWNER_DECISIONS",
  "MUST_NOT_CHANGE_APPROVED_SCRIPT",
  "MUST_NOT_INVENT_HISTORICAL_CLAIMS",
  "MUST_NOT_INVENT_HUMAN_IDENTITY",
];

export const VISUAL_DIRECTOR_INPUT_KINDS: readonly string[] = [
  "writer_report",
  "brand_report",
  "review_report",
  "scene_plan",
  "timeline_plan",
  "narration_artifact",
];

export const VISUAL_DIRECTOR_OUTPUT_KIND = "visual_direction_contract" as const;

export interface VisualDirectorInputPackage {
  readonly workflowId: string;
  readonly contentId: string;
  readonly script: string;
  readonly scriptArtifactId: string;
  readonly brandContext: Record<string, string>;
  readonly reviewArtifactId: string;
  readonly directorArtifactId: string;
  readonly narrationArtifactId: string | null;
  readonly timelineArtifactId: string | null;
  readonly priorVisualFailure: {
    readonly failedVisualArtifactIds: readonly string[];
    readonly failureNotes: readonly string[];
  } | null;
  readonly policy: {
    readonly textPolicy: string;
    readonly uiPolicy: string;
    readonly requireNoVisibleIdentity: boolean;
  };
  readonly packageVersion: 1;
}

/**
 * Compact input package V2 (Attempt-2 lesson: the verbose package with full
 * historical payloads exhausted the output budget of a reasoning-heavy model).
 * Same creative evidence, radically smaller: canonical IDs + lineage refs
 * (never re-fetched blobs), exact script text, compact brand, five narrative
 * beats, compact failure digest. Explicitly EXCLUDES: base64/data URLs, image
 * bytes, full provider payloads, repeated narration copies, duplicate
 * Director artifacts, QA boilerplate, execution logs, Timeline speculative
 * prompts, engineering RCA prose.
 */
export interface CompactVisualDirectorInput {
  readonly ids: Record<string, string>;
  readonly script: string;
  readonly brand: Record<string, string>;
  readonly beats: readonly string[];
  readonly failureDigest: readonly string[];
  readonly schemaBrief: string;
  readonly capabilityBrief: string;
  readonly policyBrief: string;
  readonly packageVersion: 2;
}

export function buildCompactVisualDirectorInput(input: {
  readonly ids?: unknown;
  readonly script?: unknown;
  readonly brand?: unknown;
  readonly beats?: unknown;
  readonly failureDigest?: unknown;
}): { readonly valid: true; readonly package: CompactVisualDirectorInput; readonly characterCount: number; readonly approxTokenCount: number } | { readonly valid: false; readonly errors: readonly string[] } {
  const errors: string[] = [];
  const ids = input.ids !== null && typeof input.ids === "object" && !Array.isArray(input.ids)
    ? input.ids as Record<string, string> : null;
  const requiredIds = ["workflowId", "contentId", "scriptArtifactId", "brandArtifactId", "reviewArtifactId", "directorArtifactId", "iterationId"];
  if (ids === null) errors.push("ids record is required (canonical references, never blobs)");
  else for (const key of requiredIds) {
    if (typeof ids[key] !== "string" || (ids[key] as string).trim().length === 0) errors.push(`ids.${key} is required`);
  }
  if (typeof input.script !== "string" || input.script.trim().length === 0) errors.push("exact approved script text is required");
  const brand = input.brand !== null && typeof input.brand === "object" && !Array.isArray(input.brand)
    ? input.brand as Record<string, string> : null;
  if (brand === null) errors.push("compact brand record is required");
  const beats = Array.isArray(input.beats) ? input.beats.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
  if (beats.length !== 5) errors.push("exactly five narrative beats are required (one per scene)");
  const digest = Array.isArray(input.failureDigest) ? input.failureDigest.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
  if (digest.length === 0) errors.push("compact failure digest is required");
  const blob = JSON.stringify({ ids, script: input.script, brand, beats, digest });
  if (/data:image\//.test(blob)) errors.push("compact package must never contain image data URLs");
  if (errors.length > 0) return { valid: false, errors };
  const pkg: CompactVisualDirectorInput = {
    ids: ids as Record<string, string>,
    script: input.script as string,
    brand: brand as Record<string, string>,
    beats,
    failureDigest: digest,
    schemaBrief: "VisualDirectionContractV2{version:2, contentId, storyVisualIdentity{visualMode[photoreal_cinematic|documentary_natural|stylized_illustration|animated_family|editorial_portrait], realismLevel, cinematicLanguage, world, era, locationLanguage, lightingLanguage, colorLanguage, textureLanguage, cameraLanguage, motionLanguage}, globalContinuity{mustRemainConsistent[], allowedVariation[], forbiddenStyleShifts[]}, characters[{characterId, description, wardrobe[], framingConstraints[], continuityNotes[]}]|[], worldRules[], forbiddenVisualModes[], defaultTextUiPolicy{textPolicy[FORBIDDEN|INCIDENTAL_NONREADABLE|REQUIRED], uiPolicy[FORBIDDEN|DEVICE_ALLOWED_SCREEN_NOT_VISIBLE|SCREEN_VISIBLE_NO_READABLE_TEXT|UI_REQUIRED]}, scenes[5]{sceneId[scene-001..005], sourceScriptSpan, narrativePurpose, subject, characterIds[], action, setting, era, shotType, cameraAngle, composition, lighting, emotion, wardrobe[], mustInclude[], mustNotInclude[], textPolicy, uiPolicy}}",
    capabilityBrief: "No character reference, IP-Adapter, ControlNet, identity LoRA, or face lock. Seed + negative prompt available. Never depend on repeated facial identity.",
    policyBrief: "TEXT FORBIDDEN, UI FORBIDDEN. No screens/phones/apps/menus/title cards/readable text/logos. Paper as texture only. One global rendering mode for all five scenes.",
    packageVersion: 2,
  };
  const characterCount = JSON.stringify(pkg).length;
  return { valid: true, package: pkg, characterCount, approxTokenCount: Math.ceil(characterCount / 4) };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Build the exact governed input package a future authorized Visual Director
 * execution would consume. Pure validation only: missing creative evidence
 * fails closed (the draft must not be fabricated from thin inputs).
 */
export function buildVisualDirectorInputPackage(input: {
  readonly workflowId?: unknown;
  readonly contentId?: unknown;
  readonly script?: unknown;
  readonly scriptArtifactId?: unknown;
  readonly brandContext?: unknown;
  readonly reviewArtifactId?: unknown;
  readonly directorArtifactId?: unknown;
  readonly narrationArtifactId?: unknown;
  readonly timelineArtifactId?: unknown;
  readonly priorVisualFailure?: {
    readonly failedVisualArtifactIds?: readonly unknown[];
    readonly failureNotes?: readonly unknown[];
  } | null;
  readonly policy?: { readonly textPolicy?: unknown; readonly uiPolicy?: unknown; readonly requireNoVisibleIdentity?: unknown };
}): { readonly valid: true; readonly package: VisualDirectorInputPackage } | { readonly valid: false; readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!nonEmpty(input.workflowId)) errors.push("workflowId is required");
  if (!nonEmpty(input.contentId)) errors.push("contentId is required");
  if (!nonEmpty(input.script)) errors.push("approved script is required (never abbreviate the canonical Writer artifact)");
  if (!nonEmpty(input.scriptArtifactId)) errors.push("scriptArtifactId is required for lineage");
  if (!nonEmpty(input.reviewArtifactId)) errors.push("reviewArtifactId is required (approved Review only)");
  if (!nonEmpty(input.directorArtifactId)) errors.push("directorArtifactId is required (source lineage, even when its brief is defective)");
  const brand = input.brandContext !== null && typeof input.brandContext === "object" && !Array.isArray(input.brandContext)
    ? input.brandContext as Record<string, string>
    : null;
  if (brand === null) errors.push("brandContext is required (Morroway identity is creative input, not optional)");
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    package: {
      workflowId: input.workflowId as string,
      contentId: input.contentId as string,
      script: input.script as string,
      scriptArtifactId: input.scriptArtifactId as string,
      brandContext: brand as Record<string, string>,
      reviewArtifactId: input.reviewArtifactId as string,
      directorArtifactId: input.directorArtifactId as string,
      narrationArtifactId: typeof input.narrationArtifactId === "string" ? input.narrationArtifactId : null,
      timelineArtifactId: typeof input.timelineArtifactId === "string" ? input.timelineArtifactId : null,
      priorVisualFailure: input.priorVisualFailure === null || input.priorVisualFailure === undefined
        ? null
        : {
          failedVisualArtifactIds: (input.priorVisualFailure.failedVisualArtifactIds ?? []).filter((v): v is string => typeof v === "string"),
          failureNotes: (input.priorVisualFailure.failureNotes ?? []).filter((v): v is string => typeof v === "string"),
        },
      policy: {
        textPolicy: typeof input.policy?.textPolicy === "string" ? input.policy.textPolicy : "FORBIDDEN",
        uiPolicy: typeof input.policy?.uiPolicy === "string" ? input.policy.uiPolicy : "FORBIDDEN",
        requireNoVisibleIdentity: input.policy?.requireNoVisibleIdentity !== false,
      },
      packageVersion: 1,
    },
  };
}
