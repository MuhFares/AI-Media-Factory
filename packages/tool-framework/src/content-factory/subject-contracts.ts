/**
 * Program 3 — bridge from durable identity (subject_profiles, scene_specs)
 * into the existing visual-direction contract layer. No duplication: this
 * module MAPS durable rows onto CharacterContract/SceneContractV2 inputs
 * consumed by the proven validate/compile functions. Brand consistency
 * (strategic truth) and character consistency (identity graph) stay separate.
 */
import type {
  CharacterContract, SceneContractV2, VisualDirectionContractV2,
} from "../visual-direction/visual-direction-contract-v2.js";

export interface SubjectView {
  readonly subjectId: string;
  readonly description: string;
  readonly wardrobe: Record<string, unknown>;
  readonly negatives: string[];
  readonly continuityNotesFor?: (sceneId: string) => string[];
}

export function subjectToCharacterContract(
  subject: {
    readonly subjectId: string; readonly description: string;
    readonly wardrobe: Record<string, unknown>; readonly negatives: string[];
  },
  framingConstraints: readonly string[] = [],
  continuityNotes: readonly string[] = [],
): CharacterContract {
  const wardrobeList = Object.entries(subject.wardrobe).map(([k, v]) => `${k}: ${String(v)}`);
  return {
    characterId: subject.subjectId,
    description: subject.description,
    wardrobe: wardrobeList,
    framingConstraints: [...framingConstraints],
    continuityNotes: [...continuityNotes, ...subject.negatives.map((n) => `never: ${n}`)],
  };
}

export function sceneSpecToSceneContract(
  scene: {
    readonly sceneId: string; readonly purpose?: string | null;
    readonly visual?: string | null; readonly environment?: string | null;
    readonly shot?: string | null; readonly cameraAngle?: string | null;
    readonly movement?: string | null; readonly scriptRef?: string | null;
    readonly continuity?: readonly string[];
    readonly subjects: readonly { readonly subjectId: string; readonly pose?: string | null; readonly expression?: string | null }[];
  },
): SceneContractV2 {
  const primary = scene.subjects[0];
  return {
    sceneId: scene.sceneId,
    sourceScriptSpan: scene.scriptRef ?? "",
    narrativePurpose: scene.purpose ?? "",
    subject: primary ? primary.subjectId : "",
    characterIds: scene.subjects.map((s) => s.subjectId),
    action: [primary?.pose, primary?.expression].filter(Boolean).join(" / "),
    setting: scene.environment ?? "",
    era: "",
    shotType: scene.shot ?? "",
    cameraAngle: scene.cameraAngle ?? "",
    composition: scene.visual ?? "",
    lighting: "",
    emotion: primary?.expression ?? "",
    wardrobe: [],
    mustInclude: [...(scene.continuity ?? [])],
    mustNotInclude: [],
    textPolicy: "FORBIDDEN",
    uiPolicy: "FORBIDDEN",
  } as SceneContractV2;
}

/** Brand context assembled from ACTIVE strategic payloads (pure input). */
export interface BrandContextInput {
  readonly brand?: { readonly brand?: string; readonly positioning?: string } | null;
  readonly constraints?: readonly string[] | null;
  readonly contentPillars?: readonly string[] | null;
}

export function brandContextSummary(input: BrandContextInput): string[] {
  const lines: string[] = [];
  if (input.brand?.brand) lines.push(`brand: ${input.brand.brand}`);
  if (input.brand?.positioning) lines.push(`positioning: ${input.brand.positioning}`);
  for (const rule of input.constraints ?? []) lines.push(`constraint: ${rule}`);
  for (const pillar of input.contentPillars ?? []) lines.push(`pillar: ${pillar}`);
  return lines;
}

/** Ordered scene IDs for composition input (stable by sequence). */
export function compositionSceneOrder(scenes: readonly { sceneId: string; sequence: number }[]): string[] {
  return [...scenes].sort((a, b) => a.sequence - b.sequence).map((s) => s.sceneId);
}
