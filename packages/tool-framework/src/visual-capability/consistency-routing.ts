/**
 * Program 3 — consistency routing over the canonical image-capability
 * profiles. No duplication: provider facts live in
 * image-capability-profiles.ts; this module adds only the Program 3
 * routing rules (identity-critical fail-closed, consistency-requires-
 * references fail-closed) on top of the proven checkReferenceSupport.
 *
 * Honest vocabulary: reference-GUIDED consistency. No provider proves
 * identity conditioning (Z-Image identity/location preservation was
 * human-unproven on the tested case); identity-critical sequences fail
 * closed to human approval instead of pretending.
 */
import {
  profileForProvider,
  checkReferenceSupport,
  type ImageReferenceInput,
} from "./image-capability-profiles.js";

export interface ConsistencyResolution {
  readonly ok: boolean;
  readonly providerIds: readonly string[];
  readonly reason: string;
}

/** Verified identity-conditioning support per provider: none verified
 *  (UNPROVEN, not FAILED — no formal controlled test exists). Provenance:
 *  Z-Image single-strength references guide composition; one tested case
 *  did not preserve location identity on human review, which is insufficient
 *  evidence to upgrade or to rule out the route. FLUX ComfyUI workflow has
 *  no identity mechanism at all. */
export function identityConditioningSupported(providerId: string): { supported: false; provenance: string } {
  if (providerId === "runpod-zimage") {
    return {
      supported: false,
      provenance: "UNPROVEN: single-strength reference guides composition only; strict identity conditioning has no verified provider path",
    };
  }
  return {
    supported: false,
    provenance: "UNPROVEN: runpod-image adapter ComfyUI T2I workflow has no image input or identity mechanism (CODE_CAPABILITY_PROVEN)",
  };
}

export interface ConsistencyRouteInput {
  readonly referenceCount: number;
  readonly referenceUrls?: readonly string[];
  readonly referenceMimeType?: string;
  readonly identityCritical?: boolean;
  readonly consistencyRequired?: boolean;
}

export function resolveConsistencyRoute(input: ConsistencyRouteInput): ConsistencyResolution {
  if (input.identityCritical === true) {
    return {
      ok: false,
      providerIds: [],
      reason: "IDENTITY_CRITICAL_NO_VERIFIED_ROUTE: no provider proves identity conditioning; human approval required",
    };
  }
  const count = input.referenceCount;
  if (!Number.isInteger(count) || count < 0) {
    return { ok: false, providerIds: [], reason: "INVALID_REFERENCE_COUNT" };
  }
  if (count > 0) {
    const profile = profileForProvider("runpod-zimage");
    if (!profile) return { ok: false, providerIds: [], reason: "REFERENCE_PROFILE_MISSING" };
    const refs: ImageReferenceInput[] = Array.from({ length: count }, () => ({
      role: "CHARACTER_REFERENCE",
      url: input.referenceUrls?.[0],
      mimeType: input.referenceMimeType,
    }));
    const check = checkReferenceSupport(profile, refs);
    if (!check.ok) return { ok: false, providerIds: [], reason: `NO_REFERENCE_ROUTE: ${check.reason}` };
    return {
      ok: true,
      providerIds: ["runpod-zimage"],
      reason: "reference-guided route (composition guidance only; identity not guaranteed)",
    };
  }
  if (input.consistencyRequired === true) {
    return {
      ok: false,
      providerIds: [],
      reason: "CONSISTENCY_REQUIRES_REFERENCES: recurring-subject generation without references would silently downgrade to plain text-to-image",
    };
  }
  return {
    ok: true,
    providerIds: ["self-hosted-image", "runpod-zimage"],
    reason: "ordinary text-to-image: both verified routes eligible",
  };
}
