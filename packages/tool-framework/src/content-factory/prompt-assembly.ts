/**
 * Program 3 — structured prompt assembly with provenance.
 * Assembles provider-neutral inputs (brand context, subject identity, scene
 * requirements, format requirements, negatives, provider caps) and delegates
 * final compilation to the proven visual-direction contract layer. The
 * returned provenance records every contributing source; nothing is
 * concatenated opaquely.
 */
import {
  compileScenePromptForTarget,
  validateVisualDirectionContract,
  type ImageTarget,
  type SceneContractV2,
  type TargetCompileResult,
  type VisualDirectionContractV2,
} from "../visual-direction/visual-direction-contract-v2.js";

export interface PromptAssemblyInput {
  readonly contract: VisualDirectionContractV2;
  readonly scene: SceneContractV2;
  readonly directorPlanId: string;
  readonly target: ImageTarget;
  readonly brandLines: readonly string[];
  readonly subjectIds: readonly string[];
  readonly referenceArtifactIds: readonly string[];
  readonly formatId: string;
}

export interface AssembledPrompt {
  readonly compiled: string;
  readonly negativePrompt: string;
  readonly target: ImageTarget;
  readonly targetNotes: readonly string[];
  readonly provenance: {
    readonly subjectIds: readonly string[];
    readonly referenceArtifactIds: readonly string[];
    readonly brandLines: readonly string[];
    readonly formatId: string;
    readonly directorPlanId: string;
  };
}

/** Fail-closed: invalid contracts never reach a provider. */
export function assembleScenePrompt(input: PromptAssemblyInput): AssembledPrompt {
  const validation = validateVisualDirectionContract(input.contract);
  if (!validation.valid) {
    throw new Error(`PROMPT_ASSEMBLY_CONTRACT_INVALID:${validation.errors.join(";").slice(0, 200)}`);
  }
  const compiled = compileScenePromptForTarget(
    input.contract, input.scene, input.directorPlanId, input.target,
  );
  if (compiled.status !== "COMPILED" || !("compiled" in compiled)) {
    throw new Error(`PROMPT_ASSEMBLY_BLOCKED:${"reason" in compiled ? String(compiled.reason).slice(0, 200) : "unknown"}`);
  }
  return {
    compiled: compiled.compiled.prompt,
    negativePrompt: compiled.compiled.negativePrompt,
    target: input.target,
    targetNotes: compiled.targetNotes,
    provenance: {
      subjectIds: [...input.subjectIds],
      referenceArtifactIds: [...input.referenceArtifactIds],
      brandLines: [...input.brandLines],
      formatId: input.formatId,
      directorPlanId: input.directorPlanId,
    },
  };
}

export type { TargetCompileResult };
