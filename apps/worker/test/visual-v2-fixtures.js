/**
 * V2 visual-direction fixtures (provider-free, deterministic).
 *
 * In production the VisualDirectionContractV2 is owned by a governed creative
 * agent (future) — never by narration echoes. In tests these fixtures play
 * that role: they declare explicit visual content for deterministic scene IDs
 * so the V2-wired bridge can compile prompts without any provider contact.
 */

export function v2SceneContract(sceneId, overrides = {}) {
  return {
    sceneId,
    sourceScriptSpan: `fixture span for ${sceneId}`,
    narrativePurpose: `fixture purpose for ${sceneId}`,
    subject: `fixture subject for ${sceneId}: a still-life study object on a plain surface`,
    characterIds: [],
    action: `fixture action for ${sceneId}: resting motionless in soft light`,
    setting: "a plain neutral studio setting",
    era: "timeless",
    shotType: "medium",
    cameraAngle: "eye level",
    composition: "single centered subject, generous negative space",
    lighting: "soft diffused daylight",
    emotion: "calm",
    wardrobe: [],
    mustInclude: ["plain surface"],
    mustNotInclude: ["text", "screen", "cartoon"],
    textPolicy: "FORBIDDEN",
    uiPolicy: "FORBIDDEN",
    ...overrides,
  };
}

export function v2DirectionContract(workflowId, sceneIds, overrides = {}) {
  return {
    version: 2,
    contentId: `content-${workflowId}`,
    storyVisualIdentity: {
      visualMode: "photoreal_cinematic",
      realismLevel: "photoreal, natural materials",
      cinematicLanguage: "quiet, observational",
      world: "neutral studio world",
      era: "timeless",
      locationLanguage: "seamless studio backdrop",
      lightingLanguage: "soft diffused daylight",
      colorLanguage: "muted neutrals",
      textureLanguage: "matte surfaces",
      cameraLanguage: "35mm, static",
      motionLanguage: "still",
    },
    globalContinuity: {
      mustRemainConsistent: ["photoreal rendering", "neutral studio world"],
      allowedVariation: ["camera angle"],
      forbiddenStyleShifts: ["cartoon", "anime", "3d render", "glamour portrait", "ui screen"],
    },
    characters: [],
    worldRules: ["no readable text", "no screens"],
    forbiddenVisualModes: ["animated_family", "stylized_illustration"],
    defaultTextUiPolicy: { textPolicy: "FORBIDDEN", uiPolicy: "FORBIDDEN" },
    scenes: sceneIds.map((sceneId) => v2SceneContract(sceneId)),
    ...(overrides.storyVisualIdentity ? { storyVisualIdentity: overrides.storyVisualIdentity } : {}),
    ...(overrides.scenes ? { scenes: overrides.scenes } : {}),
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "storyVisualIdentity" && k !== "scenes")),
  };
}

export function v2ContractArtifact(workflowId, sceneIds, artifactId, overrides = {}) {
  return {
    artifactId: artifactId ?? `art-${workflowId}-visual-direction-v2`,
    workflowId,
    correlationId: `corr-${workflowId}`,
    kind: "visual_direction_contract",
    producerAgent: "visual-direction-v2-fixture",
    status: "completed",
    payload: v2DirectionContract(workflowId, sceneIds, overrides),
    contentType: "application/json",
    schemaVersion: "2.0",
    createdAt: new Date().toISOString(),
  };
}

export async function saveV2DirectionContract(persistence, workflowId, sceneIds, artifactId, overrides = {}) {
  await persistence.saveArtifact(v2ContractArtifact(workflowId, sceneIds, artifactId, overrides));
}

/**
 * Wrap an executor so the canonical visual-direction stage returns a valid V2
 * contract (the fixture plays the governed creative-agent role). Returning the
 * artifact from the stage is important: persisting a fixture after Director
 * leaves the real visual-direction result newer than the fixture, so media
 * recovery quite correctly selects that later, invalid artifact.
 */
export function withV2ContractFixture(executor, persistence) {
  const run = executor.executeAgentStep.bind(executor);
  executor.executeAgentStep = async (step, context) => {
    const result = await run(step, context);
    if (step.id === "visual-direction" && result.status === "completed") {
      const arts = await persistence.listArtifacts(context.workflowId);
      const plan = [...arts].reverse().find((a) => a.kind === "scene_plan" && a.status === "completed");
      const ids = Array.isArray(plan?.payload?.sceneIds) ? plan.payload.sceneIds.filter((id) => typeof id === "string") : [];
      if (ids.length > 0) {
        return {
          ...result,
          artifact: v2ContractArtifact(context.workflowId, ids, result.artifact?.artifactId),
        };
      }
    }
    return result;
  };
  return executor;
}
