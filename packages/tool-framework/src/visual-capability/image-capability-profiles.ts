/**
 * Image capability profiles — evidence-sourced, provider-free, deterministic.
 *
 * Reconciles the two RunPod image paths (ComfyUI/FLUX vs Z-Image) that the
 * previous global AMF image policy blurred. Every value carries its
 * provenance; UNKNOWN stays UNKNOWN. No network, no secrets.
 *
 * Benchmark evidence (docs/visual-production-routing-v1.md Round 1: 6+6
 * paired calls; docs/visual-capability-benchmark-v1.md Z-Image T2I 4/4):
 *  - Z-Image preferred: realistic/photorealistic people, realistic cinematic,
 *    product, sports candidate. Cost $0.005/output (provider-reported).
 *  - FLUX preferred: CARTOON_2D, STYLIZED_3D. Cost UNKNOWN (adapter unreported).
 *  - Anime/fantasy/illustrative/reference/location/identity/consistency:
 *    UNPROVEN for both. No global winner assigned.
 */

export type ImageEndpointClass = "comfy-flux" | "zimage";

export interface ImagePromptLimit {
  readonly chars: number | null;
  readonly provenance: string;
}

export interface ImageReferenceSupport {
  readonly supported: boolean;
  readonly urlOnly: boolean;
  readonly maxReferences: number;
  readonly mimeTypes: readonly string[];
  readonly requiresStrength: boolean;
  readonly provenance: string;
}

export interface ImageCapabilityProfile {
  readonly capabilityId: string;
  readonly provider: string;
  readonly endpointClass: ImageEndpointClass;
  readonly positivePromptLimit: ImagePromptLimit;
  readonly negativePromptLimit: ImagePromptLimit;
  readonly negativeConditioningSupported: boolean;
  readonly referenceImages: ImageReferenceSupport;
  readonly seedSupport: boolean;
  readonly sizeSupport:
    | { readonly mode: "computed-from-aspect" }
    | { readonly mode: "fixed-set"; readonly sizes: readonly string[] };
  readonly reportedModel: string | null;
  readonly provenance: readonly string[];
  /**
   * Worker transport vs workflow consumption, tracked separately.
   * Transport = what the provider worker accepts (input.images[]).
   * workflowConsumesImages = whether the wired AMF workflow actually
   * loads those images into a conditioning path. Transport support
   * never implies reference guidance or identity conditioning.
   */
  readonly workerTransport?: {
    readonly imagesSupported: boolean;
    readonly transport: string;
    readonly workflowConsumesImages: boolean;
    readonly provenance: string;
  };
}

export const FLUX_SELF_HOSTED_PROFILE: ImageCapabilityProfile = {
  capabilityId: "image.generate",
  provider: "self-hosted-image",
  endpointClass: "comfy-flux",
  positivePromptLimit: {
    chars: 3000,
    provenance: "AMF policy IMAGE_PROMPT_MAX_CHARS: measured canonical Attempt-4 max 2345 + ~28% headroom; no provider backing in-repo (ComfyUI CLIPTextEncode takes free text)",
  },
  negativePromptLimit: {
    chars: 1000,
    provenance: "AMF policy IMAGE_NEGATIVE_PROMPT_MAX_CHARS (historical bound; measured canonical max ~330)",
  },
  negativeConditioningSupported: true,
  referenceImages: {
    supported: false,
    urlOnly: false,
    maxReferences: 0,
    mimeTypes: [],
    requiresStrength: false,
    provenance: "runpod-image adapter reads no reference fields (CODE_CAPABILITY_PROVEN)",
  },
  seedSupport: true,
  sizeSupport: { mode: "computed-from-aspect" },
  reportedModel: null,
  provenance: [
    "adapter runpod-image.ts: ComfyUI CheckpointLoaderSimple flux1-dev-fp8.safetensors + dual CLIPTextEncode + FluxGuidance + KSampler",
    "model string FLUX.1-dev-fp8 is adapter-hardcoded, NOT provider-confirmed (R8 RCA)",
    "R8: 5/5 technical successes at 768x1344 via this path (TEMPORARY_VALIDATION_STACK)",
  ],
  workerTransport: {
    imagesSupported: true,
    transport: "input.images[] with name + base64 image, referenceable from the supplied ComfyUI workflow",
    workflowConsumesImages: false,
    provenance: "Owner-supplied RunPod worker docs (FLUX.1-dev-fp8 Hub deployment); current AMF workflow has no image-loading node (verified in-repo)",
  },
};

export const ZIMAGE_PROFILE: ImageCapabilityProfile = {
  capabilityId: "image.generate",
  provider: "runpod-zimage",
  endpointClass: "zimage",
  positivePromptLimit: {
    chars: 4000,
    provenance: "capability policy runpodZImagePromptLength(): RUNPOD_ZIMAGE_MAX_PROMPT_LENGTH default 4000, ceiling 8192 (boundary.ts); adapter itself unbounded",
  },
  negativePromptLimit: {
    chars: null,
    provenance: "UNKNOWN: adapter drops negativePrompt entirely (negativeConditioning NOT_SUPPORTED); no enforced bound in-repo",
  },
  negativeConditioningSupported: false,
  referenceImages: {
    supported: true,
    urlOnly: true,
    maxReferences: 1,
    mimeTypes: ["image/png", "image/jpeg"],
    requiresStrength: true,
    provenance: "runpod-zimage adapter: referenceImageUrl http(s) only + strength 0..1 required; base64-without-URL rejected; single image field",
  },
  seedSupport: true,
  sizeSupport: {
    mode: "fixed-set",
    sizes: ["512*512", "768*768", "1024*1024", "1280*1280", "1024*768", "768*1024", "1280*720", "720*1280"],
  },
  reportedModel: "z-image-turbo",
  provenance: [
    "adapter runpod-zimage.ts: runsync + download; model field adapter-declared z-image-turbo",
    "benchmark: Z-Image T2I 4/4 HUMAN_PASS; $0.005/output provider-reported",
    "reference transport BLOCKED_BY_MISSING_INFRASTRUCTURE (no object storage / signed URL issuer in-repo)",
  ],
  workerTransport: {
    imagesSupported: true,
    transport: "input.image http(s) URL plus strength",
    workflowConsumesImages: true,
    provenance: "runpod-zimage adapter contract: single URL reference consumed by the wired request",
  },
};

const PROFILES: Readonly<Record<string, ImageCapabilityProfile>> = {
  "self-hosted-image": FLUX_SELF_HOSTED_PROFILE,
  "runpod-zimage": ZIMAGE_PROFILE,
};

/** Capability profile by provider id; UNKNOWN provider yields null (never invented). */
export function profileForProvider(providerId: string): ImageCapabilityProfile | null {
  return PROFILES[providerId] ?? null;
}

/** Hard prompt-budget compatibility (chars). Exceeding fails closed upstream. */
export function fitsPromptBudget(profile: ImageCapabilityProfile, positiveChars: number, negativeChars: number): { readonly fits: boolean; readonly reason: string | null } {
  if (profile.positivePromptLimit.chars !== null && positiveChars > profile.positivePromptLimit.chars) {
    return { fits: false, reason: `positive prompt ${positiveChars} exceeds ${profile.provider} limit ${profile.positivePromptLimit.chars}` };
  }
  if (profile.negativePromptLimit.chars !== null && negativeChars > profile.negativePromptLimit.chars) {
    return { fits: false, reason: `negative prompt ${negativeChars} exceeds ${profile.provider} limit ${profile.negativePromptLimit.chars}` };
  }
  return { fits: true, reason: null };
}

export type ImageReferenceRole =
  | "CHARACTER_REFERENCE"
  | "STYLE_REFERENCE"
  | "WORLD_REFERENCE"
  | "OBJECT_REFERENCE"
  | "PREVIOUS_SCENE_REFERENCE";

export interface ImageReferenceInput {
  readonly role: ImageReferenceRole;
  readonly url?: string;
  readonly base64?: string;
  readonly mimeType?: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Reference compatibility (pure). Semantic roles are preserved in AMF
 * provenance regardless; provider payloads stay generic. Fail-closed with
 * explicit reasons — references never silently dropped.
 */
export function checkReferenceSupport(
  profile: ImageCapabilityProfile,
  references: readonly ImageReferenceInput[],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (references.length === 0) return { ok: true };
  if (!profile.referenceImages.supported) {
    return { ok: false, reason: `${profile.provider} supports no reference images` };
  }
  if (references.length > profile.referenceImages.maxReferences) {
    return { ok: false, reason: `${profile.provider} accepts at most ${profile.referenceImages.maxReferences} reference(s)` };
  }
  for (const reference of references) {
    if (profile.referenceImages.urlOnly) {
      if (typeof reference.url !== "string" || !isHttpUrl(reference.url)) {
        return { ok: false, reason: `${profile.provider} requires an http(s) reference URL (no local path, data URL, or base64 transport in-repo)` };
      }
      if (!profile.referenceImages.mimeTypes.includes(reference.mimeType ?? "")) {
        return { ok: false, reason: `${profile.provider} reference mime must be one of ${profile.referenceImages.mimeTypes.join(", ")}` };
      }
    }
  }
  return { ok: true };
}

export interface BatchRoutingInput {
  readonly visualMode: string;
  readonly photorealismRequired: "LOW" | "MODERATE" | "HIGH";
  readonly fantasyIntensity: "LOW" | "MODERATE" | "HIGH";
  readonly humanSubjectImportance: "LOW" | "MODERATE" | "HIGH";
  readonly referenceRequirement: "NONE" | "REQUIRED";
  readonly continuityRequirement: "LOW" | "IMPORTANT";
  readonly maxPromptChars: number;
  readonly incumbentProvider?: string | null;
}

export interface BatchRoutingDecision {
  readonly recommendedCapability: "self-hosted-image" | "runpod-zimage" | "MANUAL_EXTERNAL_GENERATION";
  readonly rationale: readonly string[];
  readonly evidence: readonly string[];
  readonly confidence: "LOW" | "MEDIUM";
}

/**
 * Evidence-weighted routing advisory (deterministic, provider-free).
 * Soft benchmark signals only — never unconditional rules; owner approval
 * remains required for any batch. Continuity always prefers a single
 * capability (mixing generators breaks cross-scene coherence).
 */
export function recommendImageCapability(input: BatchRoutingInput): BatchRoutingDecision {
  const rationale: string[] = [];
  const evidence: string[] = [
    "docs/visual-production-routing-v1.md Round 1 (6 zimage + 6 FLUX paired; both pass general T2I)",
    "docs/visual-capability-benchmark-v1.md (Z-Image T2I 4/4 HUMAN_PASS; I2I location-fidelity human FAIL)",
    "docs/project-state.md (Cairo: 5 zimage production calls; zimage policy 4000/8192)",
  ];
  if (input.referenceRequirement === "REQUIRED") {
    return {
      recommendedCapability: "MANUAL_EXTERNAL_GENERATION",
      rationale: ["reference transport BLOCKED_BY_MISSING_INFRASTRUCTURE: no object storage or signed URL issuer in-repo; neither path accepts local/data-URL references"],
      evidence,
      confidence: "MEDIUM",
    };
  }
  let flux = 0;
  let zimage = 0;
  if (input.photorealismRequired === "HIGH" || input.humanSubjectImportance === "HIGH") {
    zimage += 2;
    rationale.push("benchmark prefers Z-Image for realistic/photorealistic people and realistic cinematic work (+2 zimage)");
  }
  if (input.visualMode === "stylized_illustration" || input.visualMode === "animated_family") {
    flux += 2;
    rationale.push("benchmark prefers FLUX for CARTOON_2D/STYLIZED_3D (+2 flux)");
  }
  if (input.fantasyIntensity !== "LOW") {
    flux += 1;
    rationale.push("owner-observed FLUX stylized/imaginative strength is PARTIALLY supported (cartoon/stylized proven; fantasy per se unproven) (+1 flux)");
  }
  if (input.maxPromptChars > 3000) {
    zimage += 1;
    rationale.push("prompt length exceeds the FLUX AMF budget; fits the zimage 4000 policy (+1 zimage)");
  }
  if (input.incumbentProvider === "self-hosted-image") {
    flux += 1;
    rationale.push("incumbent validation stack (R8: 5/5 technical successes) reduces operational unknowns (+1 flux)");
  }
  if (input.continuityRequirement === "IMPORTANT") {
    rationale.push("continuity IMPORTANT: single capability mandated; mixing generators rejected regardless of margin");
  }
  if (flux === zimage) {
    return { recommendedCapability: flux > 0 ? "self-hosted-image" : "runpod-zimage", rationale: [...rationale, "tied soft signals; defaulting conservatively (flux incumbent if scored, else zimage realism)"], evidence, confidence: "LOW" };
  }
  const winner = flux > zimage ? ("self-hosted-image" as const) : ("runpod-zimage" as const);
  const margin = Math.abs(flux - zimage);
  return {
    recommendedCapability: winner,
    rationale,
    evidence,
    confidence: margin >= 2 ? "MEDIUM" : "LOW",
  };
}
