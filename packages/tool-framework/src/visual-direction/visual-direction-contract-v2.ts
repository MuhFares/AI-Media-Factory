/**
 * VISUAL DIRECTION CONTRACT V2 — provider-free, deterministic, fail-closed.
 *
 * Provenance: R8 forensic RCA (wf-1789233193749-gvydpiah, attempt 8).
 * R8 produced five technically valid but semantically/style-incoherent images
 * because no durable visual language existed between Brand → Director →
 * Scene Contract → Prompt Compiler → Image Provider → Semantic QA:
 *
 *   - Director emitted free-form narration echoes ("Visually advance: <text>")
 *     with empty constraints (RCA: DIRECTOR_SEMANTIC_DRIFT + STYLE_UNDERSPEC).
 *   - The bridge compiled them 1:1 into provider prompts with NO negative
 *     prompt (RCA: PROMPT_CONSTRUCTION_LOSS).
 *   - Hard rules (no UI/text) lived only in a Timeline-planner speculative
 *     negative prompt that was never sent (RCA: PROMPT_CONTRADICTION_BY_OMISSION).
 *   - No cross-scene style lock, character, or world contract existed
 *     (RCA: STYLE/CHARACTER/WORLD_CONTINUITY_MISSING).
 *   - Semantic review returned UNAVAILABLE and the staged wan path converts
 *     gate-bypass scene decisions into human approvals (RCA: QA_DETECTION_GAP
 *     + policy-bypass provenance gap).
 *
 * This module is pure data + deterministic policy. It performs zero provider
 * I/O, zero network, zero filesystem access. It is intentionally NOT wired
 * into the production bridge: wiring is a separate owner decision
 * (see VISUAL_DIRECTION_CONTRACT_V2 design §22-24). Anything that cannot be
 * proven here returns BLOCKED / HUMAN_REVIEW_REQUIRED — never PASS.
 */

/** Closed visual-mode lock. One value is selected per content item and every
 *  scene must compile under it. Free-form style prose cannot override it. */
export const VISUAL_MODE_V2 = [
  "photoreal_cinematic",
  "documentary_natural",
  "stylized_illustration",
  "animated_family",
  "editorial_portrait",
] as const;
export type VisualModeV2 = typeof VISUAL_MODE_V2[number];

/** Text-rendering policy for a scene. FORBIDDEN means the scene concept must
 *  not depend on readable text; the compiler enforces it positively. */
export const TEXT_POLICIES = ["FORBIDDEN", "INCIDENTAL_NONREADABLE", "REQUIRED"] as const;
export type TextPolicy = typeof TEXT_POLICIES[number];

/** UI/device-composition policy for a scene. */
export const UI_POLICIES = [
  "FORBIDDEN",
  "DEVICE_ALLOWED_SCREEN_NOT_VISIBLE",
  "SCREEN_VISIBLE_NO_READABLE_TEXT",
  "UI_REQUIRED",
] as const;
export type UiPolicy = typeof UI_POLICIES[number];

/** Tokens that naturally encourage UI/text-centric compositions. A positive
 *  prompt containing these under TEXT_POLICY=FORBIDDEN (or UI_POLICY=FORBIDDEN)
 *  is a compile-time BLOCKED — the negative prompt is not trusted to repair
 *  a contradictory positive instruction (R8 scene-002 causal chain). */
const UI_CUE_TOKENS: readonly string[] = [
  "screen", "app", "application", "interface", "ui", "dashboard", "website",
  "webpage", "browser", "phone", "smartphone", "computer", "laptop", "monitor",
  "device", "tablet", "menu", "button", "icon", "overlay", "infographic",
  "software", "chat", "notification", "login",
];
const TEXT_CUE_TOKENS: readonly string[] = [
  "text", "words", "letters", "lettering", "caption", "subtitle", "title",
  "headline", "document", "poster", "sign", "billboard", "map", "list",
  "chart", "graph", "logo", "readable",
];
/**
 * Multi-word text/UI concepts. Single token "table" was removed here after
 * governed evidence proved the false positive: canonical scene-004's "long
 * oak table" (furniture) blocked a valid TEXT/FORBIDDEN scene. Data-table
 * senses are still caught as phrases below.
 */
const TEXT_PHRASE_CUES: readonly string[] = [
  "data table", "table of", "spreadsheet", "pie chart", "bar chart",
];

function tokenPresent(haystack: string, token: string): boolean {
  const normalized = ` ${haystack.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  return normalized.includes(` ${token} `);
}

function findCueTokens(text: string, tokens: readonly string[]): string[] {
  return tokens.filter((token) => tokenPresent(text, token));
}

function normalizePhrase(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Multi-word style-shift phrases (e.g. "3d render", "glamour portrait"). */
function findPhraseHits(text: string, phrases: readonly string[]): string[] {
  const normalized = normalizePhrase(text);
  const hits: string[] = [];
  for (const phrase of phrases) {
    const clean = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (clean.length > 0 && normalized.includes(` ${clean} `) && !hits.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

export interface StoryVisualIdentity {
  readonly visualMode: VisualModeV2;
  readonly realismLevel: string;
  readonly cinematicLanguage: string;
  readonly world: string;
  readonly era: string;
  readonly locationLanguage: string;
  readonly lightingLanguage: string;
  readonly colorLanguage: string;
  readonly textureLanguage: string;
  readonly cameraLanguage: string;
  readonly motionLanguage: string;
}

export interface GlobalContinuity {
  readonly mustRemainConsistent: readonly string[];
  readonly allowedVariation: readonly string[];
  readonly forbiddenStyleShifts: readonly string[];
}

export interface CharacterContract {
  readonly characterId: string;
  readonly description: string;
  readonly wardrobe: readonly string[];
  readonly framingConstraints: readonly string[];
  readonly continuityNotes: readonly string[];
}

export interface TextUiPolicy {
  readonly textPolicy: TextPolicy;
  readonly uiPolicy: UiPolicy;
}

export interface SceneContractV2 {
  readonly sceneId: string;
  readonly sourceScriptSpan: string;
  readonly narrativePurpose: string;
  readonly subject: string;
  readonly characterIds: readonly string[];
  readonly action: string;
  readonly setting: string;
  readonly era: string;
  readonly shotType: string;
  readonly cameraAngle: string;
  readonly composition: string;
  readonly lighting: string;
  readonly emotion: string;
  readonly wardrobe: readonly string[];
  readonly mustInclude: readonly string[];
  readonly mustNotInclude: readonly string[];
  readonly textPolicy: TextPolicy;
  readonly uiPolicy: UiPolicy;
}

export interface VisualDirectionContractV2 {
  readonly version: 2;
  readonly contentId: string;
  readonly storyVisualIdentity: StoryVisualIdentity;
  readonly globalContinuity: GlobalContinuity;
  readonly characters: readonly CharacterContract[];
  readonly worldRules: readonly string[];
  readonly forbiddenVisualModes: readonly VisualModeV2[];
  readonly defaultTextUiPolicy: TextUiPolicy;
  readonly scenes: readonly SceneContractV2[];
}

export interface CompiledScenePrompt {
  readonly sceneId: string;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly visualMode: VisualModeV2;
  readonly lineage: {
    readonly contentId: string;
    readonly contractVersion: 2;
    readonly styleLockApplied: boolean;
  };
}

/**
 * Prompt Envelope V2 (§9): the provider-neutral compiled unit. Conceptually
 * separate sections travel as distinct fields — GLOBAL STYLE LOCK and GLOBAL
 * CONTINUITY are compiled INTO the positive prompt (independent generations
 * share no memory), while exclusions split by responsibility: scene-salient
 * terms in the positive HARD EXCLUSIONS reminder, the full normalized set in
 * the negative prompt. Seed + policies ride alongside, never inside prose.
 */
export type PromptEnvelopeV2 = CompiledScenePrompt;

export type ContractValidation = { readonly valid: true } | { readonly valid: false; readonly errors: readonly string[] };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Structural validation of a story-level V2 contract. Fails closed on:
 * missing style lock, empty scenes, duplicate/blank scene ids, scene visual
 * mode drift (a scene-declared mode is rejected: the lock is the only mode),
 * text/UI policy incoherence, or an R8-class defect: a scene whose subject
 * or action is empty (narration-echo prompts can never satisfy this).
 */
export function validateVisualDirectionContract(contract: VisualDirectionContractV2): ContractValidation {
  const errors: string[] = [];
  // Total function: foreign untrusted payloads (e.g. LLM output) must yield
  // {valid:false} with reasons — never throw. Every access below is guarded.
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) {
    return { valid: false, errors: ["contract must be an object"] };
  }
  if ((contract as { version?: unknown }).version !== 2) errors.push("contract version must be 2");
  if (!nonEmpty((contract as { contentId?: unknown }).contentId)) errors.push("contentId is required");
  const identity = (contract as { storyVisualIdentity?: unknown }).storyVisualIdentity as StoryVisualIdentity | null | undefined;
  const identityRecord = identity !== null && typeof identity === "object" && !Array.isArray(identity)
    ? identity as unknown as Record<string, unknown> : null;
  if (identityRecord === null || typeof identityRecord.visualMode !== "string" || !(VISUAL_MODE_V2 as readonly string[]).includes(identityRecord.visualMode)) {
    errors.push("storyVisualIdentity.visualMode must be a locked VISUAL_MODE_V2 value (R8 had none)");
  }
  const forbiddenModes = (contract as { forbiddenVisualModes?: unknown }).forbiddenVisualModes;
  if (!Array.isArray(forbiddenModes)) {
    errors.push("forbiddenVisualModes must be an array");
  } else if (identityRecord !== null && forbiddenModes.includes(identityRecord.visualMode)) {
    errors.push("locked visual mode must not be listed in forbiddenVisualModes");
  }
  const continuity = (contract as { globalContinuity?: unknown }).globalContinuity;
  const continuityRecord = continuity !== null && typeof continuity === "object" && !Array.isArray(continuity)
    ? continuity as Record<string, unknown> : null;
  if (continuityRecord === null) {
    errors.push("globalContinuity is required");
  } else {
    if (!Array.isArray(continuityRecord.mustRemainConsistent)) errors.push("globalContinuity.mustRemainConsistent must be an array");
    if (!Array.isArray(continuityRecord.forbiddenStyleShifts)) errors.push("globalContinuity.forbiddenStyleShifts must be an array");
  }
  const scenes = (contract as { scenes?: unknown }).scenes;
  if (!Array.isArray(scenes)) {
    return { valid: false, errors: [...errors, "scenes must be an array"] };
  }
  if (scenes.length === 0) errors.push("at least one scene contract is required");
  const characters = (contract as { characters?: unknown }).characters;
  const characterList = Array.isArray(characters) ? characters : [];
  const seen = new Set<string>();
  for (const rawScene of scenes) {
    if (rawScene === null || typeof rawScene !== "object" || Array.isArray(rawScene)) {
      errors.push("scene must be an object");
      continue;
    }
    const scene = rawScene as Record<string, unknown>;
    if (!nonEmpty(scene.sceneId)) { errors.push("scene with blank sceneId"); continue; }
    const sceneId = scene.sceneId as string;
    if (seen.has(sceneId)) errors.push(`duplicate sceneId: ${sceneId}`);
    seen.add(sceneId);
    // R8-class defect guard: narration-echo scenes carry no visual semantics.
    if (!nonEmpty(scene.subject)) errors.push(`${sceneId}: subject is required (R8 scene prompts had no subject)`);
    if (!nonEmpty(scene.action)) errors.push(`${sceneId}: action is required (R8 scenes depicted no narrative action)`);
    if (!nonEmpty(scene.setting)) errors.push(`${sceneId}: setting is required`);
    if (!nonEmpty(scene.shotType)) errors.push(`${sceneId}: shotType is required (R8 had no camera grammar)`);
    if (!nonEmpty(scene.sourceScriptSpan)) errors.push(`${sceneId}: sourceScriptSpan is required for lineage`);
    if (typeof scene.textPolicy !== "string" || !(TEXT_POLICIES as readonly string[]).includes(scene.textPolicy)) errors.push(`${sceneId}: unknown textPolicy`);
    if (typeof scene.uiPolicy !== "string" || !(UI_POLICIES as readonly string[]).includes(scene.uiPolicy)) errors.push(`${sceneId}: unknown uiPolicy`);
    const characterIds = Array.isArray(scene.characterIds) ? scene.characterIds : [];
    for (const characterId of characterIds) {
      if (typeof characterId !== "string" || !characterList.some((c) => c !== null && typeof c === "object" && !Array.isArray(c) && (c as unknown as Record<string, unknown>).characterId === characterId)) {
        errors.push(`${sceneId}: unknown characterId ${String(characterId)} (no dangling character references)`);
      }
    }
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export type CompileResult =
  | { readonly status: "COMPILED"; readonly compiled: CompiledScenePrompt }
  | { readonly status: "BLOCKED"; readonly reason: string };

/**
 * Deterministic prompt compiler: STRUCTURED CONTRACT → PROVIDER-NEUTRAL PROMPT.
 * Section order is fixed (SUBJECT → ACTION → ENVIRONMENT → CAMERA → STYLE →
 * CONTINUITY → LIGHTING → COMPOSITION → HARD EXCLUSIONS) so identical
 * contracts always produce identical prompts. The story style lock is
 * injected by the compiler and cannot be overridden by scene prose.
 *
 * Fail-closed compile guards (no provider contact before or after):
 *  - TEXT_POLICY=FORBIDDEN + UI/text cue tokens in positive material → BLOCKED.
 *  - UI_POLICY=FORBIDDEN + UI cue tokens in positive material → BLOCKED.
 *  - mustNotInclude terms appearing in positive material → BLOCKED.
 *  - scene-declared style tokens conflicting with the lock → BLOCKED.
 */
export type ImageTarget = "flux" | "zimage";
export type WorldScope = "shared" | "isolated";

export type TargetCompileResult =
  | { readonly status: "COMPILED"; readonly compiled: CompiledScenePrompt; readonly target: ImageTarget; readonly targetNotes: readonly string[] }
  | { readonly status: "BLOCKED"; readonly reason: string; readonly target: ImageTarget; readonly targetNotes: readonly string[] };

interface CompileOptions {
  readonly worldScope: WorldScope;
  /** full: normalized negative list. target-dropped: negative emptied with an explicit note (targets without negative conditioning). */
  readonly negativeMode: "full" | "target-dropped";
  /** Isolated-scope WORLD section override (owner-directed venue scoping). Ignored unless worldScope is isolated. */
  readonly worldOverride?: string;
}

function compileInner(
  contract: VisualDirectionContractV2,
  scene: SceneContractV2,
  directorPlanId: string,
  opts: CompileOptions,
): { result: CompileResult; notes: string[] } {
  // Total function: malformed inputs BLOCK instead of throwing. Callers must
  // still validate first; this guard is defense-in-depth for direct callers.
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)
    || scene === null || typeof scene !== "object" || Array.isArray(scene)) {
    return { result: { status: "BLOCKED", reason: "contract and scene must be objects" }, notes: [] };
  }
  const identity = (contract as { storyVisualIdentity?: unknown }).storyVisualIdentity as StoryVisualIdentity | undefined;
  const continuityRoot = (contract as { globalContinuity?: unknown }).globalContinuity as GlobalContinuity | undefined;
  if (!identity || !(VISUAL_MODE_V2 as readonly string[]).includes((identity as { visualMode?: unknown }).visualMode as string) || !continuityRoot
    || !Array.isArray(continuityRoot.mustRemainConsistent) || !Array.isArray(continuityRoot.forbiddenStyleShifts)
    || !Array.isArray((contract as { scenes?: unknown }).scenes)) {
    return { result: { status: "BLOCKED", reason: "contract fails structural preconditions (validate first)" }, notes: [] };
  }
  const sceneRecord = scene as unknown as Record<string, unknown>;
  if (!nonEmpty(sceneRecord.sceneId) || !nonEmpty(sceneRecord.subject) || !nonEmpty(sceneRecord.action)) {
    return { result: { status: "BLOCKED", reason: "scene lacks required visual content (validate first)" }, notes: [] };
  }
  const lock = contract.storyVisualIdentity.visualMode;
  const strList = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const text = (value: unknown): string => typeof value === "string" ? value : "";
  const positiveMaterial = [text(scene.subject), text(scene.action), text(scene.setting), text(scene.composition), text(scene.lighting), text(scene.emotion), ...strList(scene.wardrobe), ...strList(scene.mustInclude)].join(" \n ");
  // Hard exclusion coherence: mustNotInclude must actually be excluded.
  for (const term of strList(scene.mustNotInclude)) {
    if (nonEmpty(term) && tokenPresent(positiveMaterial, term.toLowerCase())) {
      return { result: { status: "BLOCKED", reason: `mustNotInclude violated in positive material: ${term}` }, notes: [] };
    }
  }
  // Text/UI policy is enforced on the POSITIVE composition, never delegated
  // to the negative prompt alone (R8 scene-002: positive UI concept +
  // empty/weak negative produced a UI/text-centric image).
  if (scene.textPolicy === "FORBIDDEN") {
    const hits = [...findCueTokens(positiveMaterial, UI_CUE_TOKENS), ...findCueTokens(positiveMaterial, TEXT_CUE_TOKENS), ...findPhraseHits(positiveMaterial, TEXT_PHRASE_CUES)];
    if (hits.length > 0) {
      return { result: { status: "BLOCKED", reason: `TEXT_POLICY=FORBIDDEN but positive material requests UI/text concepts: ${[...new Set(hits)].join(", ")}` }, notes: [] };
    }
  }
  if (scene.uiPolicy === "FORBIDDEN") {
    const hits = findCueTokens(positiveMaterial, UI_CUE_TOKENS);
    if (hits.length > 0) {
      return { result: { status: "BLOCKED", reason: `UI_POLICY=FORBIDDEN but positive material requests UI concepts: ${[...new Set(hits)].join(", ")}` }, notes: [] };
    }
  }
  // Style-lock enforcement (§7): a scene contradicting the global forbidden
  // style shifts (e.g. photoreal lock + cartoon subject) BLOCKS BEFORE
  // provider. Scene data may vary subject/action/camera — never the mode.
  const styleHits = findPhraseHits(positiveMaterial, contract.globalContinuity.forbiddenStyleShifts);
  if (styleHits.length > 0) {
    return { result: { status: "BLOCKED", reason: `scene contradicts global style lock (forbidden shifts: ${styleHits.join(", ")})` }, notes: [] };
  }
  const sceneCharacterIds = strList(scene.characterIds);
  const contractCharacters = Array.isArray(contract.characters) ? contract.characters : [];
  const characterNotes = sceneCharacterIds
    .map((id) => contractCharacters.find((c) => c !== null && typeof c === "object" && !Array.isArray(c) && (c as unknown as Record<string, unknown>).characterId === id))
    .filter((c): c is CharacterContract => c !== undefined)
    .map((c) => `${text((c as unknown as Record<string, unknown>).description)} (${[...strList((c as unknown as Record<string, unknown>).wardrobe), ...strList((c as unknown as Record<string, unknown>).framingConstraints)].filter(Boolean).join("; ")})`);
  const continuity = [...contract.globalContinuity.mustRemainConsistent, ...sceneCharacterIds.flatMap((id) => {
    const found = contractCharacters.find((c) => c !== null && typeof c === "object" && !Array.isArray(c) && (c as unknown as Record<string, unknown>).characterId === id);
    const notes = found !== undefined ? (found as unknown as Record<string, unknown>).continuityNotes : undefined;
    return Array.isArray(notes) ? notes.filter((v): v is string => typeof v === "string") : [];
  })];
  const sceneExclusions = strList(scene.mustNotInclude);
  const normalizeExclusions = (entries: readonly string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of entries) {
      for (const part of String(entry).split(",")) {
        const term = part.trim();
        const key = term.toLowerCase();
        if (term.length > 0 && !seen.has(key)) {
          seen.add(key);
          out.push(term);
        }
      }
    }
    return out;
  };
  const globalExclusions = normalizeExclusions(
    Array.isArray(contract.globalContinuity.forbiddenStyleShifts) ? contract.globalContinuity.forbiddenStyleShifts : [],
  );
  const negativeTerms = normalizeExclusions([...globalExclusions, ...sceneExclusions]);
  // Positive/negative separation (§7): the positive prompt carries ONLY the
  // scene-specific exclusions (highest-risk, scene-salient constraints). The
  // full normalized exclusion set lives in the negative prompt
  // (defense-in-depth). No evidence supports repeating the global list
  // verbatim inside the positive prompt.
  const positiveExclusions = normalizeExclusions(sceneExclusions);
  // World scope (§10 reconciliation): "shared" appends the global location
  // language into ENVIRONMENT (legacy behavior, byte-identical). "isolated"
  // keeps ENVIRONMENT to the scene's active setting and carries the world
  // sentence once in a labeled WORLD section — structural separation, not
  // venue filtering (which would require creative mapping).
  const environmentSection = opts.worldScope === "isolated"
    ? `ENVIRONMENT: ${scene.setting}`
    : `ENVIRONMENT: ${scene.setting}, ${contract.storyVisualIdentity.locationLanguage}`;
  // Owner-directed venue scoping (§10 reconciliation): an explicit per-scene
  // world string replaces the global location language in the WORLD section.
  // Used ONLY when provided (isolated scope); never invented by the compiler.
  const worldText = opts.worldScope === "isolated" && typeof opts.worldOverride === "string" && opts.worldOverride.trim().length > 0
    ? opts.worldOverride.trim()
    : contract.storyVisualIdentity.locationLanguage;
  const sections = [
    `SUBJECT: ${scene.subject}`,
    `ACTION: ${scene.action}`,
    environmentSection,
    ...(opts.worldScope === "isolated" ? [`WORLD: ${worldText}`] : []),
    `CAMERA: ${scene.shotType}, ${scene.cameraAngle}, ${contract.storyVisualIdentity.cameraLanguage}`,
    `STYLE LOCK: ${lock}, ${contract.storyVisualIdentity.realismLevel}, ${contract.storyVisualIdentity.cinematicLanguage}, ${contract.storyVisualIdentity.textureLanguage}`,
    ...(characterNotes.length > 0 ? [`CHARACTERS: ${characterNotes.join(" | ")}`] : []),
    ...(continuity.length > 0 ? [`CONTINUITY: ${continuity.join("; ")}`] : []),
    `LIGHTING: ${scene.lighting}, ${contract.storyVisualIdentity.lightingLanguage}`,
    `COMPOSITION: ${scene.composition}`,
    `HARD EXCLUSIONS: ${positiveExclusions.join(", ") || "none"}`,
  ];
  // Negative responsibility (§7/§9): full mode empties nothing. target-dropped
  // empties the negative with an explicit note (targets without negative
  // conditioning would otherwise drop it silently — worse than honesty).
  const notes: string[] = [];
  const negative = opts.negativeMode === "full"
    ? negativeTerms.join(", ")
    : (() => {
      notes.push(`NEGATIVE_CONDITIONING_UNSUPPORTED_BY_TARGET: ${negativeTerms.length} exclusion term(s) omitted from negative channel; critical bans carried positively in HARD EXCLUSIONS`);
      return "";
    })();
  void directorPlanId;
  return {
    result: {
      status: "COMPILED",
      compiled: {
        sceneId: scene.sceneId,
        prompt: sections.join(". "),
        negativePrompt: negative,
        visualMode: lock,
        lineage: { contentId: contract.contentId, contractVersion: 2, styleLockApplied: true },
      },
    },
    notes,
  };
}

/**
 * Legacy entry point: shared world scope, full negative. Byte-identical to
 * pre-reconciliation output (proven by unchanged legacy tests).
 */
export function compileScenePrompt(
  contract: VisualDirectionContractV2,
  scene: SceneContractV2,
  directorPlanId: string,
): CompileResult {
  return compileInner(contract, scene, directorPlanId, { worldScope: "shared", negativeMode: "full" }).result;
}

/**
 * Target-aware compilation (§6): provider-neutral contract in, target-shaped
 * envelope out. Runs full structural validation first (fail-closed), then
 * compiles with the target's negative policy. No silent truncation, no
 * silent negative-dropping: every adaptation is a returned note.
 */
export function compileScenePromptForTarget(
  contract: VisualDirectionContractV2,
  scene: SceneContractV2,
  directorPlanId: string,
  target: ImageTarget,
  options: { readonly worldScope?: WorldScope; readonly worldOverride?: string } = {},
): TargetCompileResult {
  const validation = validateVisualDirectionContract(contract);
  if (!validation.valid) {
    return { status: "BLOCKED", reason: `target ${target}: contract invalid`, target, targetNotes: [] };
  }
  const found = (Array.isArray((contract as { scenes?: unknown }).scenes) ? (contract as unknown as { scenes: SceneContractV2[] }).scenes : []).some((s) => s !== null && typeof s === "object" && (s as unknown as Record<string, unknown>).sceneId === (scene as unknown as Record<string, unknown>)?.sceneId);
  if (!found) {
    return { status: "BLOCKED", reason: `target ${target}: scene not in contract`, target, targetNotes: [] };
  }
  const { result, notes } = compileInner(contract, scene, directorPlanId, {
    worldScope: options.worldScope ?? "shared",
    negativeMode: target === "zimage" ? "target-dropped" : "full",
    ...(options.worldOverride !== undefined ? { worldOverride: options.worldOverride } : {}),
  });
  if (result.status !== "COMPILED") {
    return { status: "BLOCKED", reason: result.reason, target, targetNotes: notes };
  }
  return { status: "COMPILED", compiled: result.compiled, target, targetNotes: notes };
}

export type SemanticRoute = "PROCEED_PER_GATE_POLICY" | "HUMAN_REVIEW_REQUIRED" | "BLOCKED";

/**
 * Fail-closed semantic routing (V2 policy §29):
 *  - FAIL → BLOCKED always (no gate can bless a failed semantic check here;
 *    iteration is a separate owner action).
 *  - UNAVAILABLE → HUMAN_REVIEW_REQUIRED when the human gate is enabled;
 *    BLOCKED when it is disabled. Disabling human review MUST NOT turn an
 *    UNAVAILABLE automated check into an approval (R8 gap: staged wan path
 *    converted bypass scene decisions into human approvals).
 *  - PASS → proceed strictly per gate policy (this function does not approve).
 */
export function routeVisualSemanticStatus(
  semantic: "PASS" | "FAIL" | "UNAVAILABLE" | "HUMAN_REVIEW_REQUIRED",
  humanGateEnabled: boolean,
): SemanticRoute {
  if (semantic === "FAIL") return "BLOCKED";
  if (semantic === "UNAVAILABLE" || semantic === "HUMAN_REVIEW_REQUIRED") {
    return humanGateEnabled ? "HUMAN_REVIEW_REQUIRED" : "BLOCKED";
  }
  return "PROCEED_PER_GATE_POLICY";
}

/**
 * V2 semantic QA dimensions (§16). Without a multimodal runtime every visual
 * dimension is UNKNOWN (never PASS, never FAIL from deterministic code);
 * the overall verdict stays UNAVAILABLE / HUMAN_REVIEW_REQUIRED.
 */
export const SEMANTIC_QA_DIMENSIONS = [
  "SCENE_INTENT_MATCH",
  "SUBJECT_MATCH",
  "ACTION_MATCH",
  "SETTING_MATCH",
  "ERA_MATCH",
  "STYLE_MATCH",
  "CHARACTER_CONTINUITY",
  "WORLD_CONTINUITY",
  "TEXT_POLICY_COMPLIANCE",
  "UI_POLICY_COMPLIANCE",
  "BRAND_VISUAL_ALIGNMENT",
] as const;
export type SemanticQaDimension = typeof SEMANTIC_QA_DIMENSIONS[number];

export function unknownSemanticDimensions(reason: string): Record<SemanticQaDimension, { readonly verdict: "UNKNOWN"; readonly reason: string }> {
  return Object.fromEntries(
    SEMANTIC_QA_DIMENSIONS.map((dimension) => [dimension, { verdict: "UNKNOWN" as const, reason }]),
  ) as Record<SemanticQaDimension, { readonly verdict: "UNKNOWN"; readonly reason: string }>;
}

export interface WorldScopeExpectation {
  readonly sceneId: string;
  /** At least one must appear in ENVIRONMENT/WORLD sections. */
  readonly allowedVenueTokens: readonly string[];
  /** None may appear in ENVIRONMENT/WORLD sections (global continuity motifs elsewhere are allowed). */
  readonly forbiddenVenueTokens: readonly string[];
}

/**
 * Deterministic world-scope audit (§6/§10 reconciliation). Inspects ONLY the
 * ENVIRONMENT and WORLD sections of a compiled prompt — threshold/continuity
 * motifs in CONTINUITY and elsewhere are legitimate and ignored. Pure.
 */
export function checkWorldScope(prompt: string, expectation: WorldScopeExpectation): { readonly pass: boolean; readonly violations: readonly string[] } {
  const sections = String(prompt).split(". ").filter((part) => part.startsWith("ENVIRONMENT:") || part.startsWith("WORLD:"));
  const text = sections.join(" ");
  const violations: string[] = [];
  if (findPhraseHits(text, expectation.allowedVenueTokens).length === 0) {
    violations.push(`no allowed venue token in ENVIRONMENT/WORLD for ${expectation.sceneId}`);
  }
  for (const hit of findPhraseHits(text, expectation.forbiddenVenueTokens)) {
    violations.push(`forbidden venue token in ENVIRONMENT/WORLD for ${expectation.sceneId}: ${hit}`);
  }
  return { pass: violations.length === 0, violations };
}
