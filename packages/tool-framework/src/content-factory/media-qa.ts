/**
 * Program 3 — media QA V2 (image checks + character-consistency contract).
 * Deterministic checks over artifact records. Automated PASS/FAIL is used
 * ONLY when a real measured signal exists; otherwise honesty states rule:
 * REFERENCE_LINKED / HUMAN_APPROVED. Identity accuracy is never claimed
 * without measurement.
 */

export interface ImageArtifactView {
  readonly artifactId: string;
  readonly kind: string;
  readonly status: string;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly payload?: Record<string, unknown> | null;
}

export interface ImageExpectation {
  readonly width?: number | null;
  readonly height?: number | null;
  readonly aspectRatio?: string | null;
  readonly subjectId?: string | null;
  readonly referenceIds?: readonly string[];
  readonly sceneId?: string | null;
}

export interface ImageCheck {
  readonly check: string;
  readonly pass: boolean;
  readonly detail: string;
}

/** Aspect comparison with tolerance (768x1344 is near-9:16, not exact). */
function aspectMatches(w: number, h: number, expected: string): boolean {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(expected.trim());
  if (!m) return false;
  const target = Number(m[1]) / Number(m[2]);
  if (!Number.isFinite(target) || target <= 0 || h <= 0) return false;
  return Math.abs(w / h - target) / target < 0.02;
}

/** Structural QA for one generated scene image. No biometrics, no guessing. */
export function checkImageArtifact(
  artifact: ImageArtifactView,
  expected: ImageExpectation,
): ImageCheck[] {
  const checks: ImageCheck[] = [];
  checks.push({
    check: "artifact-exists",
    pass: artifact.status === "completed",
    detail: `status=${artifact.status}`,
  });
  if (expected.width !== undefined && expected.width !== null
    && expected.height !== undefined && expected.height !== null) {
    const w = artifact.width ?? (artifact.payload?.width as number | undefined);
    const h = artifact.height ?? (artifact.payload?.height as number | undefined);
    checks.push({
      check: "dimensions",
      pass: w === expected.width && h === expected.height,
      detail: `expected ${expected.width}x${expected.height}, observed ${w ?? "?"}x${h ?? "?"}`,
    });
  }
  if (expected.aspectRatio) {
    const w = artifact.width ?? (artifact.payload?.width as number | undefined);
    const h = artifact.height ?? (artifact.payload?.height as number | undefined);
    const okDims = typeof w === "number" && typeof h === "number" && aspectMatches(w, h, expected.aspectRatio);
    checks.push({
      check: "aspect-ratio",
      pass: okDims,
      detail: `expected ${expected.aspectRatio}`,
    });
  }
  if (expected.subjectId) {
    const linked = artifact.payload?.subjectId ?? artifact.payload?.subject_id;
    checks.push({
      check: "subject-expected",
      pass: linked === expected.subjectId,
      detail: linked === expected.subjectId ? `subject ${expected.subjectId} linked` : "subject linkage missing or mismatched",
    });
  }
  if (expected.referenceIds && expected.referenceIds.length > 0) {
    const got = artifact.payload?.referenceArtifactIds ?? artifact.payload?.reference_artifact_ids;
    const list = Array.isArray(got) ? got : [];
    const missing = expected.referenceIds.filter((id) => !list.includes(id));
    checks.push({
      check: "reference-linkage",
      pass: missing.length === 0,
      detail: missing.length === 0 ? `${list.length} reference(s) linked` : `missing references: ${missing.join(",")}`,
    });
  }
  if (expected.sceneId) {
    const sid = artifact.payload?.sceneId ?? artifact.payload?.scene_id;
    checks.push({
      check: "continuity-metadata",
      pass: sid === expected.sceneId,
      detail: sid === expected.sceneId ? `scene ${expected.sceneId} recorded` : "scene linkage missing",
    });
  }
  const providerOk = artifact.payload?.providerResultValid;
  checks.push({
    check: "provider-result-valid",
    pass: providerOk !== false,
    detail: providerOk === false ? "provider flagged its own result invalid" : "no provider invalidation recorded",
  });
  return checks;
}

export type ConsistencyState =
  | "NOT_REQUIRED"
  | "UNVERIFIED"
  | "REFERENCE_LINKED"
  | "HUMAN_APPROVED"
  | "AUTOMATED_CHECK_PASS"
  | "AUTOMATED_CHECK_FAIL";

/**
 * Consistency state machine. Automated PASS/FAIL requires a real numeric
 * similarity signal plus threshold; otherwise REFERENCE_LINKED (references
 * present) or HUMAN_APPROVED (explicit) are the only positive states.
 */
export function consistencyState(input: {
  readonly requiresConsistency: boolean;
  readonly referencesLinked: boolean;
  readonly humanApproved: boolean;
  readonly automatedScore?: number | null;
  readonly automatedThreshold?: number | null;
}): ConsistencyState {
  if (!input.requiresConsistency) return "NOT_REQUIRED";
  if (input.automatedScore !== undefined && input.automatedScore !== null
    && input.automatedThreshold !== undefined && input.automatedThreshold !== null
    && Number.isFinite(input.automatedScore) && Number.isFinite(input.automatedThreshold)) {
    return input.automatedScore >= input.automatedThreshold ? "AUTOMATED_CHECK_PASS" : "AUTOMATED_CHECK_FAIL";
  }
  if (input.humanApproved) return "HUMAN_APPROVED";
  if (input.referencesLinked) return "REFERENCE_LINKED";
  return "UNVERIFIED";
}

/** Thumbnail presence for a content item (existing thumbnail_report kind). */
export function thumbnailPresent(artifacts: readonly { kind: string; status: string }[]): boolean {
  return artifacts.some((a) => a.kind === "thumbnail_report" && a.status === "completed");
}
