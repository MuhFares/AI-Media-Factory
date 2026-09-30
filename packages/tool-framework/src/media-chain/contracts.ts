/** Provider-neutral contracts for the production media chain. */
export interface NarrationArtifact {
  workflowId: string; contentId: string; scriptIdentity: string; language: string; voice: string;
  provider: string; audioArtifactReference: string; durationMs: number; audioIntegrity: "VALID" | "INVALID" | "UNKNOWN";
  generationId: string; sha256?: string;
}

export interface FinalMediaArtifact {
  workflowId: string; contentId: string; scriptIdentity: string; narrationIdentity: string; timelineIdentity: string;
  sceneClipIdentities: string[]; compositionIdentity: string; finalFileReference: string; durationMs: number;
  resolution: { width: number; height: number }; container: string; videoCodec: string; audioCodec: string;
  captionStatus: string; brandingStatus: string; sha256?: string;
}

export function assertMeasuredNarration(value: NarrationArtifact): void {
  if (!value.audioArtifactReference || !value.generationId || value.audioIntegrity !== "VALID" || !Number.isFinite(value.durationMs) || value.durationMs <= 0) throw new Error("NARRATION_ARTIFACT_INVALID");
}

export function assertSceneLineage(sceneIds: readonly string[], artifactSceneIds: readonly string[]): void {
  if (sceneIds.length !== artifactSceneIds.length || sceneIds.some((id, i) => id !== artifactSceneIds[i])) throw new Error("SCENE_IDENTITY_MISMATCH");
}
