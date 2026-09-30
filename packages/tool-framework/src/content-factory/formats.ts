/**
 * Program 3 — canonical format profiles.
 * Short-form YouTube and long-form YouTube are supported product contracts;
 * reel/tiktok/square are architecturally allowed placeholders (never
 * presented as supported). Dimensions follow verified provider mappings.
 */
export interface FormatProfile {
  readonly id: string;
  readonly label: string;
  readonly status: "supported" | "planned";
  readonly aspectRatio: string;
  readonly width: number;
  readonly height: number;
  readonly targetDurationMs: readonly [number, number];
  readonly pacing: string;
  readonly safeAreas: string;
  readonly captionRules: string;
  readonly thumbnailRequirement: string;
  readonly audioExpectations: string;
}

export const FORMAT_PROFILES: readonly FormatProfile[] = [
  {
    id: "youtube-short",
    label: "YouTube Short / vertical short-form",
    status: "supported",
    aspectRatio: "9:16",
    width: 768,
    height: 1344,
    targetDurationMs: [15000, 60000],
    pacing: "hook in first 2s; one idea per 3-5s beat",
    safeAreas: "keep titles/faces clear of top/bottom platform chrome",
    captionRules: "burned-in captions optional; no auto-caption claims",
    thumbnailRequirement: "not required (Shorts feed); poster frame from final media when available",
    audioExpectations: "single narration track; no music bed unless explicitly approved",
  },
  {
    id: "youtube-longform",
    label: "Long-form YouTube / horizontal",
    status: "supported",
    aspectRatio: "16:9",
    width: 1344,
    height: 768,
    targetDurationMs: [480000, 3600000],
    pacing: "chaptered scenes; recurring subject anchor per chapter",
    safeAreas: "16:9 full-bleed safe; end-screen margin on final 20s",
    captionRules: "burned-in captions optional; no auto-caption claims",
    thumbnailRequirement: "thumbnail artifact required (thumbnail_report), linked to content",
    audioExpectations: "narration plus approved audio beds only",
  },
  {
    id: "instagram-reel",
    label: "Instagram Reel",
    status: "planned",
    aspectRatio: "9:16",
    width: 768,
    height: 1344,
    targetDurationMs: [15000, 90000],
    pacing: "TBD",
    safeAreas: "TBD",
    captionRules: "TBD",
    thumbnailRequirement: "TBD",
    audioExpectations: "TBD",
  },
  {
    id: "tiktok",
    label: "TikTok",
    status: "planned",
    aspectRatio: "9:16",
    width: 768,
    height: 1344,
    targetDurationMs: [15000, 600000],
    pacing: "TBD",
    safeAreas: "TBD",
    captionRules: "TBD",
    thumbnailRequirement: "TBD",
    audioExpectations: "TBD",
  },
  {
    id: "square-social",
    label: "Square social asset",
    status: "planned",
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    targetDurationMs: [0, 0],
    pacing: "TBD",
    safeAreas: "TBD",
    captionRules: "TBD",
    thumbnailRequirement: "TBD",
    audioExpectations: "TBD",
  },
];

export function formatProfile(id: string): FormatProfile | null {
  return FORMAT_PROFILES.find((f) => f.id === id) ?? null;
}

/** Scene IDs in composition order (sequence ascending, stable). */
export function orderScenesForComposition<T extends { sceneId: string; sequence: number }>(
  scenes: readonly T[],
): string[] {
  return [...scenes].sort((a, b) => a.sequence - b.sequence).map((s) => s.sceneId);
}
