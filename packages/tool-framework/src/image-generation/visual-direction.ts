import { createHash } from "node:crypto";

export interface VisualDirection {
  subject: string;
  environment: string;
  action: string;
  composition: string;
  shotType: string;
  cameraAngle: string;
  lensIntent: string;
  lighting: string;
  depthOfField: string;
  texture: string;
  materialDetail: string;
  culturalContext?: string;
  imperfections: string;
  colorTreatment: string;
  realismTarget: string;
  negativeConstraints: readonly string[];
}

export function assembleAppearancePrompt(direction: VisualDirection): string {
  const parts = [direction.subject, direction.environment, direction.action, direction.composition, `${direction.shotType}, ${direction.cameraAngle}`, direction.lensIntent, direction.lighting, direction.depthOfField, direction.texture, direction.materialDetail, direction.culturalContext, direction.imperfections, direction.colorTreatment, direction.realismTarget].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.join(", ");
}

export function assembleNegativeConstraints(direction: VisualDirection): string {
  return direction.negativeConstraints.join(", ");
}

export function deterministicImageSeed(timelineId: string, sceneId: string, generationVersion: string): number {
  const digest = createHash("sha256").update(`${timelineId}:${sceneId}:${generationVersion}`).digest("hex").slice(0, 8);
  return Number.parseInt(digest, 16) % 1_000_000_000;
}
