/**
 * Program 3 — provider-neutral generation intent.
 * The workflow expresses WHAT to generate (subject, references, scene,
 * consistency needs); adapters translate intent into provider requests.
 * Business logic never depends on provider parameter names.
 *
 * Dependency direction is deliberate: this module takes a capability
 * resolution as INPUT (resolved by the caller via resolveConsistencyRoute
 * against the canonical image-capability profiles) so tool-framework
 * never depends on provider-adapters.
 */
export interface CapabilityResolution {
  readonly ok: boolean;
  readonly providerIds: readonly string[];
  readonly reason: string;
}

export interface ReferenceResolution {
  readonly artifactId: string;
  /** Resolved externally-reachable URL (Z-Image requires http(s) URLs). */
  readonly url: string;
  readonly mimeType: "image/png" | "image/jpeg";
}

export interface SceneGenerationIntent {
  readonly sceneId: string;
  readonly prompt: string;
  readonly subjectIds: readonly string[];
  readonly references: readonly ReferenceResolution[];
  readonly consistencyRequired: boolean;
  readonly identityCritical: boolean;
  readonly aspectRatio: string;
  readonly seed?: number | null;
}

export interface AdapterImageRequest {
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly seed?: number;
  readonly referenceImageUrl?: string;
  readonly referenceImageMimeType?: "image/png" | "image/jpeg";
  readonly strength?: number;
}

/**
 * Resolve + translate one scene intent. Fail-closed: incompatible
 * provider/shape combinations throw before any provider call. Default
 * strength is explicit and conservative (LOW revision, not identity work).
 */
export function intentToImageRequest(
  intent: SceneGenerationIntent,
  providerId: string,
  resolution: CapabilityResolution,
  strength = 0.35,
): AdapterImageRequest {
  if (!intent.prompt.trim()) throw new Error("GENERATION_INTENT_PROMPT_REQUIRED");
  if (!resolution.ok || !resolution.providerIds.includes(providerId)) {
    throw new Error(`GENERATION_INTENT_NO_ROUTE:${resolution.reason.slice(0, 160)}`);
  }
  if (intent.references.length > 0) {
    const ref = intent.references[0];
    if (!/^https:\/\//i.test(ref.url)) {
      throw new Error("GENERATION_INTENT_REFERENCE_URL_REQUIRED");
    }
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
      throw new Error("GENERATION_INTENT_STRENGTH_INVALID");
    }
    const req: AdapterImageRequest = { prompt: intent.prompt, aspectRatio: intent.aspectRatio };
    const withRef: AdapterImageRequest = {
      ...req,
      referenceImageUrl: ref.url,
      referenceImageMimeType: ref.mimeType,
      strength,
    };
    return intent.seed !== undefined && intent.seed !== null
      ? { ...withRef, seed: intent.seed }
      : withRef;
  }
  return intent.seed !== undefined && intent.seed !== null
    ? { prompt: intent.prompt, aspectRatio: intent.aspectRatio, seed: intent.seed }
    : { prompt: intent.prompt, aspectRatio: intent.aspectRatio };
}
