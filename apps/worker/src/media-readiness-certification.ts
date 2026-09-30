import type pg from "pg";
import { createCapabilityRegistry, type CapabilityGrant } from "@ai-media-factory/tool-framework";
import {
  PROVIDER_CAPABILITIES,
  DEFAULT_PROVIDER_GRANTS,
} from "@ai-media-factory/provider-adapters";
import { assertWorkerBuildParity } from "@ai-media-factory/database";
import { computeMediaBuildId } from "./media-build-identity.js";

/**
 * Running-worker readiness certification (R7 hardening).
 *
 * Proves, without introspecting the live process and without any provider
 * call, that the RUNNING persistent worker started from a bundle containing
 * the canonical grant registry:
 *
 *   1. recompute the expected build id locally (same checkout whose dist the
 *      worker loaded — enforced by step 2);
 *   2. require a live PERSISTENT presence row with the identical build id
 *      (MEDIA_WORKER_BUILD_DRIFT otherwise);
 *   3. certify the exact production caller grants against the canonical
 *      registry of THIS bundle (identical bytes => identical grants).
 */

export interface MediaGrantCertification {
  readonly timelineAuthorized: boolean;
  readonly ttsAuthorized: boolean;
  readonly sceneImageAuthorized: boolean;
  readonly directorTimelineAuthorized: boolean;
  readonly noWildcardGrant: boolean;
}

const MEDIA_CAPABILITY_IDS: readonly string[] = [
  "tts.generate",
  "timeline.plan",
  "image.generate",
  "web.search",
  "video.generate",
  "publish.youtube",
  "analytics.fetch",
];

export function certifyMediaGrants(grants: readonly CapabilityGrant[] = DEFAULT_PROVIDER_GRANTS): MediaGrantCertification {
  const resolver = createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants });
  const authorized = (agentId: string, capabilityId: string): boolean => {
    try {
      return resolver.isAuthorized(agentId, capabilityId);
    } catch {
      return false;
    }
  };
  return {
    timelineAuthorized: authorized("timeline", "timeline.plan"),
    ttsAuthorized: authorized("tts", "tts.generate"),
    sceneImageAuthorized: authorized("scene-image", "image.generate"),
    directorTimelineAuthorized: authorized("director", "timeline.plan"),
    noWildcardGrant: !grants.some((grant) => MEDIA_CAPABILITY_IDS.every((capability) => grant.capabilityIds.includes(capability))),
  };
}

export function assertMediaGrants(certification: MediaGrantCertification): void {
  if (!certification.timelineAuthorized) throw new Error("MEDIA_GRANT_DRIFT:TIMELINE_CALLER_NOT_AUTHORIZED");
  if (!certification.ttsAuthorized) throw new Error("MEDIA_GRANT_DRIFT:TTS_CALLER_NOT_AUTHORIZED");
  if (!certification.sceneImageAuthorized) throw new Error("MEDIA_GRANT_DRIFT:IMAGE_CALLER_NOT_AUTHORIZED");
  if (!certification.directorTimelineAuthorized) throw new Error("MEDIA_GRANT_DRIFT:DIRECTOR_CALLER_NOT_AUTHORIZED");
  if (!certification.noWildcardGrant) throw new Error("MEDIA_GRANT_DRIFT:WILDCARD_GRANT_PRESENT");
}

export interface PersistentWorkerReadiness {
  readonly expectedBuildId: string;
  readonly workerInstanceId: string;
  readonly workerBuildId: string;
  readonly grants: MediaGrantCertification;
}

/**
 * Full pre-authorization readiness for a future live resume: build parity
 * against the live persistent worker PLUS canonical grant certification.
 * Throws MEDIA_WORKER_BUILD_DRIFT / MEDIA_GRANT_DRIFT before any mutation.
 * Provider-free; pool reads only.
 */
export async function certifyPersistentWorkerReadiness(
  pool: pg.Pool,
  expectedBuildId: string = computeMediaBuildId().buildId,
  maxHeartbeatAgeMs = 300_000,
): Promise<PersistentWorkerReadiness> {
  const presence = await assertWorkerBuildParity(pool, expectedBuildId, maxHeartbeatAgeMs);
  const grants = certifyMediaGrants();
  assertMediaGrants(grants);
  return {
    expectedBuildId,
    workerInstanceId: presence.workerInstanceId,
    workerBuildId: presence.buildId,
    grants,
  };
}
