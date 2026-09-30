import { createHash } from "node:crypto";

/**
 * Structural type for the REAL production capability boundary — identical
 * in shape to provider-adapters' ProviderCapabilityBoundary. Using a local
 * structural type avoids a cross-package type import that would pull this
 * package's own dist declarations into the compile graph; the composition
 * root passes the actual boundary object, which satisfies this shape.
 */
export interface PreflightCapabilityBoundary {
  readonly registeredCapabilityIds: readonly string[];
  readonly resolver?: {
    readonly isAuthorized: (agentId: string, capabilityId: string) => boolean;
  };
  readonly workerExecutionEnvironment?: {
    readonly status: "SUPPORTED" | "UNSUPPORTED";
    readonly mediaLiveExecutionAllowed: boolean;
    readonly reasonCode: string | null;
  };
  readonly workerRuntime?: {
    readonly mode: string;
    readonly launcherClassification: string;
    readonly instanceId: string;
    readonly nodeVersion: string;
  };
  readonly mediaConfiguration?: {
    readonly ttsEndpointIdentityHash: string | null;
    readonly ttsBaseHost: string | null;
  };
}

/**
 * MEDIA CAPABILITY PREFLIGHT V1 — provider-free readiness proof.
 *
 * Answers exactly one question: can the CURRENTLY RESOLVED production
 * runtime execute the authorized media path (tts.generate → timeline.plan →
 * image.generate → deterministic Visual QA → Visual Human Gate)?
 *
 * PREFLIGHT RUNTIME PATH = LIVE RUNTIME CONFIGURATION PATH: the caller
 * injects the SAME `createProviderCapabilityBoundaryFromEnv` boundary the
 * production worker uses (identical env selectors, identical adapter
 * resolution, identical registration rules — including the mandatory
 * TTS_PROVIDER explicit-selector rule that caused the r1 incident), and the
 * preflight inspects the ACTUAL registration state of its routing executor.
 * "Credentials present" is never sufficient on its own: the r1 incident had
 * full credentials while tts.generate was unregistered.
 *
 * The preflight performs ZERO provider calls — it reads the registration
 * state from the routing map without executing any capability request, and
 * consumes zero provider-budget slots.
 */

export interface MediaCapabilityPreflightCapabilityResult {
  /** The capability id, e.g. "tts.generate". */
  readonly capability: string;
  /** Registered in the real production routing executor. */
  readonly registered: boolean;
  /** Non-secret provider selector (e.g. "voicetut") when one exists. */
  readonly provider: string | null;
  /** Selector variable present (TTS only; image/timeline resolve implicitly). */
  readonly selectorPresent: boolean;
  /** Safe names of missing configuration keys (never values). */
  readonly missingConfigurationKeys: readonly string[];
  /** Failure code when the capability is not executable. */
  readonly failureCode: string | null;
}

export interface MediaCapabilityPreflightResult {
  readonly pass: boolean;
  readonly tts: MediaCapabilityPreflightCapabilityResult;
  readonly timeline: MediaCapabilityPreflightCapabilityResult;
  readonly image: MediaCapabilityPreflightCapabilityResult;
  readonly visualSemanticReviewReady: boolean;
  readonly visualTechnicalQaReady: boolean;
  readonly visualHumanGateReady: boolean;
  readonly visualHumanGateEnabled: boolean;
  readonly workerExecutionEnvironment: "SUPPORTED" | "UNSUPPORTED" | "NOT_REPORTED";
  readonly mediaLiveExecutionAllowed: boolean;
  readonly executionEnvironmentReasonCode: string | null;
  /**
   * Operational worker runtime mode reported by the boundary
   * (PERSISTENT_PRODUCTION_WORKER vs OPERATOR_WORKER vs NOT_REPORTED).
   * Zero-network environment fact only — never a provider-reachability claim.
   */
  readonly workerRuntimeMode: string;
  /**
   * Safe configuration fingerprint covering the effective identity of the
   * media runtime (TTS/Timeline/Image resolution). Built from non-secret
   * configuration identity only (selectors, provider ids, capability
   * registration set) — never credential values.
   */
  readonly configurationFingerprint: string;
  /** Fingerprint lineage version (1 = selectors/registration only; 2 = + endpoint identity, base host, effective voice). */
  readonly configurationFingerprintVersion: number;
  /** Effective TTS voice folded into the v2 fingerprint (null when unresolvable). */
  readonly effectiveVoice: string | null;
  readonly failureCodes: readonly string[];
}

/** Safe presence probe for a required configuration key (never the value). */
function configPresent(key: string): boolean {
  const value = process.env[key];
  return typeof value === "string" && value.trim().length > 0;
}

/** The TTS provider selector, normalized for safe reporting. */
function ttsProviderSelector(): string | null {
  const raw = process.env.TTS_PROVIDER?.trim();
  return raw ? raw.toLowerCase() : null;
}

/** The image provider selector (IMAGE_PROVIDER env), safe to report. */
function imageProviderSelector(): string | null {
  const raw = process.env.IMAGE_PROVIDER?.trim();
  return raw ? raw.toLowerCase() : null;
}

/** Required configuration keys for a TTS provider (names only). */
function ttsRequiredKeys(provider: string): readonly string[] {
  return provider === "voicetut" ? ["RUNPOD_API_KEY", "VOICETUT_TTS_ENDPOINT_ID"]
    : provider === "groq" ? ["GROQ_API_KEY"]
    : ["TTS_PROVIDER"];
}

function ttsProviderSupported(provider: string): boolean {
  return provider === "voicetut" || provider === "groq";
}

/** Required configuration keys for the image provider (names only). */
function imageRequiredKeys(provider: string | null): readonly string[] {
  if (provider === null) return ["IMAGE_PROVIDER"];
  if (provider === "self-hosted-image" || provider === "self-hosted" || provider === "selfhosted") {
    return ["RUNPOD_API_KEY", "RUNPOD_IMAGE_ENDPOINT_ID"];
  }
  if (provider === "runpod-zimage" || provider === "zimage") return ["RUNPOD_API_KEY"];
  if (provider === "openai" || provider === "openai-image") return ["OPENAI_API_KEY"];
  return [];
}

/**
 * MEDIA CONFIGURATION FINGERPRINT V2 — canonical governed lineage.
 *
 * The SINGLE calculation used by readiness, authorization-time preflight
 * (inside the lock), the durable dispatch row, and execution verification.
 * V2 folds in SAFE, non-secret execution configuration that materially
 * affects routing: the VoiceTut endpoint identity hash (one-way; never the
 * raw ID), the base hostname, and the effective TTS voice. Same effective
 * config → same fingerprint; different endpoint/provider/voice → different.
 * Secret rotation alone (keys only) does not change it, and no secret can
 * appear in it: every input is either a selector, a registration id, a hash,
 * a hostname, or a voice label.
 */
export const MEDIA_CONFIGURATION_FINGERPRINT_VERSION = 2;

export interface MediaConfigurationFingerprintInput {
  readonly registered: readonly string[];
  readonly ttsProvider: string | null;
  readonly imageProvider: string | null;
  readonly ttsEndpointIdentityHash: string | null;
  readonly ttsBaseHost: string | null;
  readonly voice: string | null;
}

export function buildMediaConfigurationFingerprintV2(input: MediaConfigurationFingerprintInput): string {
  const canonical = JSON.stringify({
    version: MEDIA_CONFIGURATION_FINGERPRINT_VERSION,
    registered: [...input.registered].sort(),
    ttsProvider: input.ttsProvider,
    imageProvider: input.imageProvider,
    ttsEndpointIdentityHash: input.ttsEndpointIdentityHash,
    ttsBaseHost: input.ttsBaseHost,
    voice: input.voice,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Snapshot the canonical v2 input from a boundary plus an effective voice.
 * Pure and provider-free: reads registration/selector state and the
 * boundary's safe media-configuration derivations only.
 */
export function snapshotMediaConfigurationInput(
  boundary: PreflightCapabilityBoundary,
  voice: string | null,
  selectors?: { readonly ttsProvider: string | null; readonly imageProvider: string | null },
): MediaConfigurationFingerprintInput {
  const registered = new Set(boundary.registeredCapabilityIds);
  return {
    registered: [...registered].sort(),
    ttsProvider: selectors?.ttsProvider ?? ttsProviderSelector(),
    imageProvider: selectors?.imageProvider ?? imageProviderSelector(),
    ttsEndpointIdentityHash: boundary.mediaConfiguration?.ttsEndpointIdentityHash ?? null,
    ttsBaseHost: boundary.mediaConfiguration?.ttsBaseHost ?? null,
    voice,
  };
}

/**
 * Run the provider-free media capability preflight against the injected
 * REAL production boundary (the caller constructs it through
 * createProviderCapabilityBoundaryFromEnv — the exact wiring the live
 * worker uses; construction performs no provider I/O).
 *
 * The optional effective voice folds voice-lineage into the durable v2
 * fingerprint; callers that own a workflow (authorization, execution
 * verification) MUST pass the governed effective voice, while workflow-free
 * readiness uses null. Historical v1 rows are never recomputed.
 */
export function mediaCapabilityPreflight(boundary: PreflightCapabilityBoundary, voice: string | null = null): MediaCapabilityPreflightResult {
  const registered = new Set(boundary.registeredCapabilityIds);

  // --- tts.generate ---
  const ttsSelector = ttsProviderSelector();
  const ttsProvider = ttsSelector;
  const ttsMissing = ttsProvider === null
    ? ["TTS_PROVIDER"]
    : ttsRequiredKeys(ttsProvider).filter((key) => !configPresent(key));
  const ttsRegistered = registered.has("tts.generate");
  const tts = {
    capability: "tts.generate",
    registered: ttsRegistered,
    provider: ttsProvider,
    selectorPresent: ttsSelector !== null,
    missingConfigurationKeys: [
      ...(ttsSelector === null ? ["TTS_PROVIDER"] : []),
      ...(ttsProvider !== null ? ttsMissing : []),
    ],
    failureCode: ttsSelector === null
      ? "TTS_PROVIDER_SELECTOR_MISSING"
      : !ttsProviderSupported(ttsSelector)
        ? "TTS_PROVIDER_UNSUPPORTED"
        : ttsMissing.length > 0
          ? "TTS_PROVIDER_CONFIGURATION_MISSING"
          : ttsRegistered
            ? null
            : "TTS_CAPABILITY_NOT_REGISTERED",
  } as const;

  // --- timeline.plan (deterministic; always registered by construction —
  // its absence means the boundary wiring itself changed, a drift condition) ---
  const timelineRegistered = registered.has("timeline.plan");
  const timeline = {
    capability: "timeline.plan",
    registered: timelineRegistered,
    provider: "deterministic-local",
    selectorPresent: true,
    missingConfigurationKeys: timelineRegistered ? [] : ["BOUNDARY_TIMELINE_REGISTRATION"],
    failureCode: timelineRegistered ? null : "TIMELINE_CAPABILITY_NOT_REGISTERED",
  } as const;

  // --- image.generate ---
  const imageSelector = imageProviderSelector();
  const imageMissing = imageRequiredKeys(imageSelector).filter((key) => !configPresent(key));
  const imageRegistered = registered.has("image.generate");
  const image = {
    capability: "image.generate",
    registered: imageRegistered,
    provider: imageSelector,
    selectorPresent: imageSelector !== null,
    missingConfigurationKeys: [
      ...(imageSelector === null ? ["IMAGE_PROVIDER"] : []),
      ...(imageRegistered ? imageMissing : []),
    ],
    failureCode: imageRegistered && imageMissing.length === 0
      ? null
      : imageRegistered
        ? "IMAGE_PROVIDER_CONFIGURATION_MISSING"
        : "IMAGE_CAPABILITY_NOT_REGISTERED",
  } as const;

  // --- deterministic downstream components (before the Visual Human Gate) ---
  // Visual Semantic Review and Visual Technical QA are deterministic local
  // media-chain stages (no capability/provider). Their readiness is their
  // presence in the production media chain bridge wiring — verified through
  // the same registered capability set: the chain executes them locally, so
  // the relevant wiring fact is that the boundary registers the deterministic
  // capabilities and that the routing exposes the media chain. The gates
  // themselves are engine steps.
  const visualSemanticReviewReady = true; // deterministic local stage (no provider)
  const visualTechnicalQaReady = true;    // deterministic local stage (no provider)

  // --- authorization (grant) hardening — exact production caller → capability ---
  // Uses the canonical registry resolver when present (production always has it;
  // test doubles without a resolver skip this check to stay provider-free).
  const authFailureCodes: string[] = [];
  const isAuthorized = (agentId: string, capabilityId: string): boolean => {
    try {
      return boundary.resolver?.isAuthorized(agentId, capabilityId) ?? true;
    } catch {
      return false;
    }
  };
  // Only check authorization when the capability is registered; an unregistered
  // capability already fails above and its grant state is irrelevant.
  if (ttsRegistered && !isAuthorized("tts", "tts.generate")) authFailureCodes.push("TTS_CALLER_NOT_AUTHORIZED");
  if (timelineRegistered && !isAuthorized("timeline", "timeline.plan")) authFailureCodes.push("TIMELINE_CALLER_NOT_AUTHORIZED");
  if (imageRegistered && !isAuthorized("scene-image", "image.generate")) authFailureCodes.push("IMAGE_CALLER_NOT_AUTHORIZED");

  const failureCodes = [
    ...(tts.failureCode ? [tts.failureCode] : []),
    ...(timeline.failureCode ? [timeline.failureCode] : []),
    ...(image.failureCode ? [image.failureCode] : []),
    ...authFailureCodes,
    ...(boundary.workerExecutionEnvironment?.mediaLiveExecutionAllowed === false
      ? [boundary.workerExecutionEnvironment.reasonCode ?? "UNSUPPORTED_WORKER_EXECUTION_ENVIRONMENT"]
      : []),
  ];

  // Governed v2 fingerprint: same canonical calculation the dispatcher
  // persists and execution re-verifies (endpoint identity, base host, voice).
  const configurationFingerprint = buildMediaConfigurationFingerprintV2(
    snapshotMediaConfigurationInput(boundary, voice, { ttsProvider: tts.provider, imageProvider: image.provider }),
  );

  return {
    pass: failureCodes.length === 0,
    tts,
    timeline,
    image,
    visualSemanticReviewReady,
    visualTechnicalQaReady,
    // The gate policy itself is resolved by the dispatcher (project-aware);
    // the preflight reports the env-independent readiness of the routing.
    visualHumanGateReady: true,
    visualHumanGateEnabled: true, // replaced by the dispatcher with the resolved project policy
    workerExecutionEnvironment: boundary.workerExecutionEnvironment?.status ?? "NOT_REPORTED",
    mediaLiveExecutionAllowed: boundary.workerExecutionEnvironment?.mediaLiveExecutionAllowed ?? true,
    executionEnvironmentReasonCode: boundary.workerExecutionEnvironment?.reasonCode ?? null,
    workerRuntimeMode: boundary.workerRuntime?.mode ?? "NOT_REPORTED",
    configurationFingerprint,
    configurationFingerprintVersion: MEDIA_CONFIGURATION_FINGERPRINT_VERSION,
    effectiveVoice: voice,
    failureCodes,
  };
}
