/**
 * Timeline planner — deterministic-v2.
 *
 * Generation-aware: one scene = one Wan clip. No scene may require more
 * narration coverage than one clip can cover (scene.durationMs <= maxClipDurationMs).
 * Semantic splitting at Egyptian conjunctions, concept detection, 100% narration
 * preservation via canonical normalization.
 */

import { createHash } from "node:crypto";
import { buildBriefImagePrompt, buildBriefNegativePrompt, buildSceneVisualBrief, type SceneVisualBrief } from "./visual-brief.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VisualType = "broll" | "environment" | "person" | "product" | "ui" | "code" | "infographic" | "abstract";
export type SpeakingMode = "none" | "voiceover" | "talking_head";
export type ShotType = "wide" | "medium" | "closeup" | "over_shoulder";
export type CameraMovement = "static" | "slow_push_in" | "slow_pull_out" | "subtle_pan" | "gentle_drift";
export type Transition = "cut" | "fade";

export type SceneConcept =
  | "hook"
  | "writing"
  | "data_analysis"
  | "image_generation"
  | "video_generation"
  | "coding"
  | "automation"
  | "workflow"
  | "environment"
  | "generic_technology"
  | "call_to_action";

export interface TimelineCharacter {
  id: string;
  role: string;
  description: string;
  speakingMode: SpeakingMode;
}

export interface VideoGenerationProfile {
  providerFamily: string;
  preferredClipDurationMs: number;
  maxClipDurationMs: number;
  oneClipPerScene: boolean;
}

export interface TimelineScene {
  sceneId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  narration: { text: string; startMs: number; endMs: number };
  sceneConcept: SceneConcept;
  visualBrief?: SceneVisualBrief;
  purpose: string;
  visualType: VisualType;
  visualDescription: string;
  characters: string[];
  characterUseReason?: string;
  speakingMode: SpeakingMode;
  imagePrompt: string;
  motionPrompt: string;
  negativePrompt: string;
  camera: { shotType: ShotType; movement: CameraMovement };
  mood: string;
  transitionOut?: Transition;
  generation: { targetDurationMs: number; requiresImageGeneration: boolean; requiresVideoGeneration: boolean };
}

export interface TimelinePlan {
  timelineId: string;
  status: "completed";
  // Narration coverage (timeline)
  narrationDurationMs: number;
  timelineCoverageDurationMs: number;
  timelineCoverageRatio: number;
  // Generated visual coverage (clips)
  estimatedGeneratedVideoDurationMs: number;
  generatedVisualCoverageRatio: number;
  requiredVideoClipCount: number;
  // Legacy aliases for backwards compat (same as timeline coverage)
  plannedVisualDurationMs: number;
  coverageRatio: number;
  // Structure
  sceneCount: number;
  characters: TimelineCharacter[];
  scenes: TimelineScene[];
  warnings: string[];
  generationSummary: { imageCount: number; videoClipCount: number; estimatedGeneratedVideoDurationMs: number };
  generationProfile: VideoGenerationProfile;
  timingSource: "estimated_from_total_duration";
  plannerVersion: string;
}

export interface TimelinePlannerInput {
  script: string;
  narrationDurationMs: number;
  language?: string;
  dialect?: string;
  audience?: string;
  culturalContext?: string;
  visualStyle?: string;
  visualMode?: import("../visual-capability/visual-capability.js").VisualMode;
  referenceStrategy?: import("../visual-capability/visual-capability.js").ReferenceStrategy;
  maxSceneDurationMs?: number;
  minSceneDurationMs?: number;
  preferredClipDurationMs?: number;
  allowPeople?: boolean;
  allowTalkingHead?: boolean;
  videoGenerationProfile?: Partial<VideoGenerationProfile>;
}

export interface TimelinePlanner {
  readonly id: string;
  plan(input: TimelinePlannerInput): TimelinePlan;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULTS = {
  maxSceneDurationMs: 6000,
  minSceneDurationMs: 2500,
  preferredClipDurationMs: 5000,
};

const DEFAULT_GENERATION_PROFILE: VideoGenerationProfile = {
  providerFamily: "wan2.2",
  preferredClipDurationMs: 5000,
  maxClipDurationMs: 5000,
  oneClipPerScene: true,
};

export function normalizeScript(script: string): string {
  return script.trim().replace(/\s+/gu, " ");
}

// Canonical normalization for 100% preservation check: same as normalizeScript
// (only whitespace collapse + trim — no punctuation stripping that would lose content)
export function canonicalNormalize(script: string): string {
  return normalizeScript(script);
}

// ---------------------------------------------------------------------------
// Concept detection
// ---------------------------------------------------------------------------

const CONCEPT_PATTERNS: Array<{ concept: SceneConcept; re: RegExp }> = [
  { concept: "writing", re: /كتابة|محتوى|نص|سكريبت|مقال/u },
  { concept: "data_analysis", re: /بيانات|تحليل|dashboard|charts|أرقام/u },
  { concept: "image_generation", re: /صور|صورة|خيال|imagery/u },
  { concept: "video_generation", re: /فيديو|فيديوهات|متحرك|حركة/u },
  { concept: "coding", re: /python|sql|code|برمجة|pipeline/u },
  { concept: "automation", re: /يساعدنا|يقدر|بقى يقدر/u },
  { concept: "workflow", re: /workflow|سير عمل/u },
  { concept: "generic_technology", re: /ذكاء|اصطناعي|ai|تقنية|تكنولوجيا/u },
];

function detectConcepts(segment: string): SceneConcept[] {
  const found: SceneConcept[] = [];
  for (const { concept, re } of CONCEPT_PATTERNS) {
    if (re.test(segment.toLowerCase())) found.push(concept);
  }
  return found;
}

function primaryConcept(segment: string, index: number, total: number): SceneConcept {
  const concepts = detectConcepts(segment);
  if (concepts.length === 0) {
    if (index === 0) return "hook";
    if (index === total - 1) return "call_to_action";
    return "environment";
  }
  // Prefer most specific for this segment position
  // For the Egyptian short: second sentence contains writing+data+image+video
  // We use the first detected concept as primary, but the multi-concept nature
  // is what drives the split — individual concepts become separate scenes
  return concepts[0];
}

// ---------------------------------------------------------------------------
// Semantic segmentation — v2: punct + commas + Egyptian conjunctions + concept boundaries
// ---------------------------------------------------------------------------

const SEGMENT_RE = /[^۔؟!،.!?]+[۔؟!،.!?]+|[^۔؟!،.!?]+$/gu;

// Egyptian conjunctions that join distinct ideas without punctuation
const CONJUNCTION_RE = /\s+و(?=\S)/gu; // "و" as prefix of next word: "وكتابة" or "و تحليل"

function splitAtConjunctions(segment: string): string[] {
  // Split on "و" that joins distinct visual concepts, but only if segment contains multiple concepts
  const concepts = detectConcepts(segment);
  if (concepts.length <= 1) return [segment];

  // Find all "و" conjunction boundaries (Arabic و attached or standalone)
  // We split on patterns like " و" or " و" between concepts
  // Safer: split on " و" that is followed by a concept keyword
  const markers = ["وتحليل", "وعمل", "وكمان", " وبعدين", " من أول", " لحد", " لكن", " بس "];
  let parts: string[] = [segment];
  for (const marker of markers) {
    const next: string[] = [];
    for (const p of parts) {
      if (p.includes(marker.trim())) {
        // Split at the marker, keeping it with the next part
        const idx = p.indexOf(marker.trim());
        if (idx > 10) { // don't split if marker is near start
          const before = p.slice(0, idx).trim();
          const after = p.slice(idx).trim();
          if (before.length > 10 && after.length > 10) {
            next.push(before);
            next.push(after);
            continue;
          }
        }
      }
      next.push(p);
    }
    parts = next;
  }

  // Also try generic "و" split for remaining long multi-concept segments
  if (parts.length === 1 && segment.length > 60 && concepts.length >= 2) {
    // Split on " و" boundaries
    const words = segment.split(/\s+/u);
    const subSegments: string[] = [];
    let cur: string[] = [];
    for (const word of words) {
      if (word.startsWith("و") && word.length > 1 && cur.length > 0) {
        // Start new sub-segment at this conjunction
        const curText = cur.join(" ");
        if (curText.length > 15) {
          subSegments.push(curText);
          cur = [word];
          continue;
        }
      }
      cur.push(word);
    }
    if (cur.length > 0) subSegments.push(cur.join(" "));
    // Only use if it actually splits into meaningful parts
    if (subSegments.length > 1 && subSegments.every((s) => s.length > 10)) {
      return subSegments;
    }
  }

  return parts;
}

function segmentText(script: string): string[] {
  const normalized = normalizeScript(script);
  const matches = [...normalized.matchAll(SEGMENT_RE)].map((m) => m[0].trim()).filter((s) => s.length > 0);
  const base = matches.length === 0 ? [normalized] : matches;

  // Step 1: split overly long segments at commas
  const afterCommas: string[] = [];
  for (const seg of base) {
    if (seg.length > 80) {
      const parts = seg.split(/[،,]\s*/u).map((p) => p.trim()).filter((p) => p.length > 0);
      if (parts.length > 1) {
        for (let i = 0; i < parts.length; i++) {
          afterCommas.push(i < parts.length - 1 ? `${parts[i]}،` : parts[i]);
        }
        continue;
      }
    }
    afterCommas.push(seg);
  }

  // Step 2: split multi-concept segments at Egyptian conjunctions
  const result: string[] = [];
  for (const seg of afterCommas) {
    const conjParts = splitAtConjunctions(seg);
    for (const p of conjParts) result.push(p);
  }

  return result;
}

function inferVisualType(segment: string, concept: SceneConcept): VisualType {
  const map: Record<SceneConcept, VisualType> = {
    writing: "broll",
    data_analysis: "code",
    image_generation: "abstract",
    video_generation: "abstract",
    coding: "code",
    automation: "environment",
    workflow: "ui",
    environment: "environment",
    hook: "broll",
    generic_technology: "environment",
    call_to_action: "broll",
  };
  return map[concept] ?? "broll";
}

function inferPurpose(concept: SceneConcept, index: number, total: number): string {
  if (index === 0 && concept === "hook") return "Introduce the core idea — hook the viewer";
  if (index === total - 1) return "Reinforce the payoff and call to action";
  const map: Record<string, string> = {
    writing: "Show AI-assisted content writing",
    data_analysis: "Visualize AI analyzing business data",
    image_generation: "Show AI transforming an idea into generated imagery",
    video_generation: "Show AI animating imagery into video",
    coding: "Show data/tech work in action",
    automation: "Show automation in action",
    workflow: "Show workflow orchestration",
    environment: "Show the narration-relevant environment",
    generic_technology: "Support narration with relevant B-roll",
  };
  return map[concept] ?? "Support narration with relevant B-roll";
}

function buildImagePrompt(segment: string, visualType: VisualType, concept: SceneConcept, culturalContext: string | undefined, visualStyle: string | undefined, purpose: string): string {
  const baseStyle = "cinematic vertical composition, 480x832, soft natural lighting, modern aesthetic";
  const context = culturalContext === "egyptian" ? "Egyptian/Middle Eastern context, modern setting" : "modern setting";
  const conceptMap: Record<SceneConcept, string> = {
    hook: `a narration-relevant human-scale visual subject in its real-world setting, ${context}, ${baseStyle}`,
    writing: `modern content creation workspace, abstract article structure and notes on screen, no readable text, ${context}, ${baseStyle}`,
    data_analysis: `modern analytics workspace, abstract dashboard with charts and data patterns, no readable numbers, blurred interface labels, ${context}, ${baseStyle}`,
    image_generation: `creative AI workspace showing abstract transition from text idea into visual frames, flowing light, ${baseStyle}`,
    video_generation: `visual frames subtly transforming and coming to life, abstract motion preview, ${baseStyle}`,
    coding: `close-up of hands near laptop with abstract code-like structures on screen, no readable text, ${context}, ${baseStyle}`,
    automation: `modern tech workspace with subtle automation indicators, ${context}, ${baseStyle}`,
    workflow: `person at modern desk with abstract workflow nodes on screen, no readable text, ${context}, ${baseStyle}`,
    environment: `a narration-relevant real-world environment or object, ${context}, ${baseStyle}`,
    generic_technology: `a narration-relevant environment or object, ${context}, ${baseStyle}`,
    call_to_action: `person in natural B-roll, looking inspired at screen, ${context}, ${baseStyle}`,
  };
  const hint = segment.slice(0, 50).replace(/["\n]/gu, "");
  const styleHint = visualStyle?.trim() ? `, ${visualStyle.trim()}` : "";
  return `${conceptMap[concept] ?? conceptMap.generic_technology}${styleHint} — inspired by: "${hint}" — ${purpose.toLowerCase()}`;
}

function buildMotionPrompt(visualType: VisualType, concept: SceneConcept): string {
  if (concept === "data_analysis") return "subtle chart animations, data patterns shifting gently, no speaking, no readable text change";
  if (concept === "image_generation") return "abstract frames forming and transforming, gentle camera drift, no speaking";
  if (concept === "video_generation") return "frames animating, subtle motion emerging, gentle push-in, no speaking";
  const map: Record<VisualType, string> = {
    code: "slow push-in on screen, subtle cursor movement, gentle glow changes, no speaking, no readable text",
    ui: "subtle pan across desk, soft hand movement on trackpad, screen content shifting gently, no speaking",
    abstract: "flowing particle motion, gentle camera drift, light evolving, no human subject",
    broll: "gentle camera drift, natural subtle movement, breathing, no speaking or lip movement",
    environment: "slow drift through space, ambient light shifting, no human subject",
    person: "natural B-roll motion — hands, posture shift, looking at screen — no speaking, no lip sync",
    product: "slow orbit around product, subtle light reflections, no human",
    infographic: "elements animating in, subtle chart transitions, no human",
  };
  return map[visualType] ?? map.broll;
}

function buildNegativePrompt(allowTalkingHead: boolean): string {
  const base = "distorted hands, text artifacts, blurry, low quality, watermark, readable text, exact numbers, logos";
  if (!allowTalkingHead) return `${base}, speaking, lip movement, talking head, mouth open, presenter speaking to camera`;
  return base;
}

function pickCamera(visualType: VisualType): { shotType: ShotType; movement: CameraMovement } {
  if (visualType === "code") return { shotType: "closeup", movement: "slow_push_in" };
  if (visualType === "abstract" || visualType === "environment") return { shotType: "wide", movement: "gentle_drift" };
  return { shotType: "medium", movement: "subtle_pan" };
}

function pickMood(purpose: string): string {
  if (purpose.includes("hook") || purpose.includes("Introduce")) return "curious and inviting";
  if (purpose.includes("payoff") || purpose.includes("Reinforce")) return "confident and inspiring";
  return "focused and calm";
}

/**
 * Split any segment whose proportional duration exceeds maxMs into
 * word-bounded pieces that each fit, distributing duration by character
 * share (exact sum preserved). Deterministic; text preserved exactly
 * (pieces rejoin with single spaces, which canonicalNormalize collapses).
 * A single over-long word falls back to character slicing.
 */
function splitOversizeSegments(
  segments: string[],
  durations: number[],
  maxMs: number,
): { segments: string[]; durations: number[] } {
  const outSegments: string[] = [];
  const outDurations: number[] = [];
  const apportion = (parts: string[], totalDur: number): number[] => {
    const total = parts.reduce((s, p) => s + p.length, 0) || 1;
    const durs = parts.map((p) => Math.max(1, Math.round((p.length / total) * totalDur)));
    durs[durs.length - 1] += totalDur - durs.reduce((a, b) => a + b, 0);
    return durs;
  };
  const pushPieces = (parts: string[], totalDur: number): void => {
    const durs = apportion(parts, totalDur);
    for (let i = 0; i < parts.length; i++) {
      outSegments.push(parts[i]);
      outDurations.push(durs[i]);
    }
  };
  for (let i = 0; i < segments.length; i++) {
    const text = segments[i];
    const dur = durations[i];
    if (dur <= maxMs || text.trim().length === 0) {
      outSegments.push(text);
      outDurations.push(dur);
      continue;
    }
    const msPerChar = dur / Math.max(1, text.length);
    const maxChars = Math.max(1, Math.floor(maxMs / Math.max(msPerChar, 1e-9)));
    const words = text.split(/\s+/u).filter((w) => w.length > 0);
    const pieces: string[] = [];
    let cur = "";
    const flush = (): void => {
      if (cur.length > 0) {
        pieces.push(cur);
        cur = "";
      }
    };
    for (const word of words) {
      if (word.length > maxChars) {
        // Pathological single word: character-slice it.
        flush();
        for (let s = 0; s < word.length; s += maxChars) pieces.push(word.slice(s, s + maxChars));
        continue;
      }
      const candidate = cur.length === 0 ? word : `${cur} ${word}`;
      if (candidate.length > maxChars && cur.length > 0) {
        flush();
        cur = word;
      } else {
        cur = candidate;
      }
    }
    flush();
    if (pieces.length <= 1) {
      outSegments.push(text);
      outDurations.push(dur);
      continue;
    }
    pushPieces(pieces, dur);
  }
  return { segments: outSegments, durations: outDurations };
}

// ---------------------------------------------------------------------------
// Main planning — deterministic-v2
// ---------------------------------------------------------------------------

export class DeterministicTimelinePlanner implements TimelinePlanner {
  readonly id = "deterministic-v2";

  plan(input: TimelinePlannerInput): TimelinePlan {
    const script = normalizeScript(input.script);
    const narrationDurationMs = input.narrationDurationMs;
    const allowPeople = input.allowPeople ?? true;
    const allowTalkingHead = input.allowTalkingHead ?? false;
    const culturalContext = input.culturalContext;

    // Resolve generation profile
    const profile: VideoGenerationProfile = {
      ...DEFAULT_GENERATION_PROFILE,
      ...input.videoGenerationProfile,
      preferredClipDurationMs: input.preferredClipDurationMs ?? input.videoGenerationProfile?.preferredClipDurationMs ?? DEFAULT_GENERATION_PROFILE.preferredClipDurationMs,
      maxClipDurationMs: input.videoGenerationProfile?.maxClipDurationMs ?? input.preferredClipDurationMs ?? DEFAULT_GENERATION_PROFILE.maxClipDurationMs,
    };
    if (input.preferredClipDurationMs !== undefined) {
      profile.preferredClipDurationMs = input.preferredClipDurationMs;
      if (input.videoGenerationProfile?.maxClipDurationMs === undefined) profile.maxClipDurationMs = input.preferredClipDurationMs;
    }

    const minScene = input.minSceneDurationMs ?? DEFAULTS.minSceneDurationMs;

    // Semantic segmentation
    const rawSegments = segmentText(script);

    // Estimate per-segment duration proportional to char count
    const rawTotalChars = rawSegments.reduce((s, seg) => s + seg.length, 0) || 1;
    const rawDurations = rawSegments.map((seg) => Math.round((seg.length / rawTotalChars) * narrationDurationMs));
    // Fix rounding drift
    const rawSum = rawDurations.reduce((a, b) => a + b, 0);
    if (rawSegments.length > 0) rawDurations[rawDurations.length - 1] += narrationDurationMs - rawSum;

    // Generation-aware pre-split: no single segment may exceed maxClip.
    // Otherwise it becomes its own over-max scene and the plan fails its own
    // coverage invariant (R7: 30920ms narration with ~6300ms segments ->
    // INVALID_PLAN "generated visual coverage violated: 30000 < 30920").
    // Splitting is deterministic and word-bounded (char fallback), preserves
    // text exactly, so 100% narration preservation still holds.
    const maxNarrationPerSceneMs = profile.maxClipDurationMs;
    const split = splitOversizeSegments(rawSegments, rawDurations, maxNarrationPerSceneMs);
    const segments = split.segments;
    const segDurations = split.durations;

    // Generation-aware grouping: NO scene may exceed maxNarrationPerSceneMs
    // Each segment that alone exceeds max must be kept as its own scene (no merging can fix it — it's a data signal)
    // Multi-segment scenes must not exceed max either
    const sceneGroups: string[][] = [];
    const groupDurations: number[] = [];
    const groupConcepts: SceneConcept[][] = [];

    let curGroup: string[] = [];
    let curDur = 0;
    let curConcepts: SceneConcept[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segDur = segDurations[i];
      const segConcept = primaryConcept(segments[i], i, segments.length);

      // If this single segment already exceeds max, it must be its own scene (even if over max, we warn)
      // This is a signal that the segment itself is too long for one clip
      if (segDur > maxNarrationPerSceneMs && curGroup.length === 0) {
        sceneGroups.push([segments[i]]);
        groupDurations.push(segDur);
        groupConcepts.push([segConcept]);
        continue;
      }

      // If adding this segment would exceed max, emit current group first
      if (curGroup.length > 0 && curDur + segDur > maxNarrationPerSceneMs) {
        sceneGroups.push(curGroup);
        groupDurations.push(curDur);
        groupConcepts.push(curConcepts);
        curGroup = [];
        curDur = 0;
        curConcepts = [];
      }

      curGroup.push(segments[i]);
      curDur += segDur;
      curConcepts.push(segConcept);

      const isLast = i === segments.length - 1;
      // Emit if we hit minScene and next segment would push over max, or if last
      if (isLast) {
        sceneGroups.push(curGroup);
        groupDurations.push(curDur);
        groupConcepts.push(curConcepts);
        curGroup = []; curDur = 0; curConcepts = [];
      } else {
        // Lookahead: if current group already >= minScene and next segment would exceed max, emit now
        const nextDur = segDurations[i + 1];
        if (curDur >= minScene && curDur + nextDur > maxNarrationPerSceneMs) {
          sceneGroups.push(curGroup);
          groupDurations.push(curDur);
          groupConcepts.push(curConcepts);
          curGroup = []; curDur = 0; curConcepts = [];
        }
      }
    }
    if (curGroup.length > 0) {
      sceneGroups.push(curGroup);
      groupDurations.push(curDur);
      groupConcepts.push(curConcepts);
    }

    // Coverage check: ensure generated clips cover narration
    // With oneClipPerScene, estimatedGenerated = sceneCount * preferredClip
    // If < narration, we need more scenes — split the longest scene
    // For now, sceneGroups already sum to narrationDuration (timeline coverage), but generated coverage
    // is sceneCount * preferredClip. We ensure that >= narration.
    // If not enough, it means we need to split more — but our maxNarrationPerScene already forces splits
    // For 12640/5000: ceil(12640/5000)=3 clips needed. Our grouping above should produce 3 scenes if it respects max 5000.

    // Build characters
    const allConcepts = groupConcepts.flat();
    const needsPerson = allConcepts.some((c) => c === "hook" || c === "call_to_action");
    const characters: TimelineCharacter[] = [];
    const locationSensitiveCairo = /cairo|القاهرة|egypt|egyptian|مصر|مصري/iu.test(`${input.visualStyle ?? ""} ${culturalContext ?? ""}`);
    if (needsPerson && allowPeople && !locationSensitiveCairo) {
      characters.push({
        id: "host-1",
        role: "narration-relevant person",
        description: culturalContext === "egyptian"
          ? "ordinary Egyptian person relevant to the narration, natural appearance, contemporary everyday clothing"
          : "ordinary person relevant to the narration, natural appearance, context-appropriate everyday clothing",
        speakingMode: "none",
      });
    }

    // Build scenes
    const scenes: TimelineScene[] = [];
    let cursorMs = 0;
    const warnings: string[] = [];

    for (let i = 0; i < sceneGroups.length; i++) {
      const groupText = sceneGroups[i].join(" ");
      const dur = groupDurations[i];
      const concepts = groupConcepts[i];
      const primary = primaryConcept(groupText, i, sceneGroups.length);
      const visualType = inferVisualType(groupText, primary);
      const purpose = inferPurpose(primary, i, sceneGroups.length);
      const speakingMode: SpeakingMode = "voiceover";
      const visualBrief = buildSceneVisualBrief(`scene-${String(i + 1).padStart(3, "0")}`, groupText, i, sceneGroups.length, input.visualStyle, culturalContext);
      const charIds = visualBrief === undefined && (visualType === "broll" || visualType === "person") && characters.length > 0 && (primary === "hook" || primary === "call_to_action")
        ? ["host-1"]
        : [];

      const imagePrompt = visualBrief === undefined
        ? buildImagePrompt(groupText, visualType, primary, culturalContext, input.visualStyle, purpose)
        : buildBriefImagePrompt(visualBrief);
      const motionPrompt = visualBrief === undefined
        ? `${buildMotionPrompt(visualType, primary)}${input.visualStyle?.trim() ? `, ${input.visualStyle.trim()}` : ""}`
        : visualBrief.motionIntent;
      const negativePrompt = visualBrief === undefined ? buildNegativePrompt(allowTalkingHead) : buildBriefNegativePrompt(visualBrief);
      const camera = pickCamera(visualType);
      const mood = pickMood(purpose);

      if (dur > maxNarrationPerSceneMs + 100) {
        warnings.push(`scene-${String(i + 1).padStart(3, "0")} duration ${dur}ms exceeds maxClipDuration ${maxNarrationPerSceneMs}ms`);
      }

      const characterUseReason = charIds.length > 0 ? "B-roll hook — person provides human connection without delivering narration" : undefined;

      // Generation target must cover the scene's narration slice (tiny rounding over preferredClip is allowed)
      const targetDurationMs = Math.max(profile.preferredClipDurationMs, dur);
      scenes.push({
        sceneId: `scene-${String(i + 1).padStart(3, "0")}`,
        startMs: cursorMs,
        endMs: cursorMs + dur,
        durationMs: dur,
        narration: { text: groupText, startMs: cursorMs, endMs: cursorMs + dur },
        sceneConcept: primary,
        ...(visualBrief === undefined ? {} : { visualBrief }),
        purpose,
        visualType,
        visualDescription: visualBrief?.semanticSubject ?? `${purpose} — ${primary} — ${visualType} visual`,
        characters: charIds,
        ...(characterUseReason ? { characterUseReason } : {}),
        speakingMode,
        imagePrompt,
        motionPrompt,
        negativePrompt,
        camera,
        mood,
        transitionOut: i < sceneGroups.length - 1 ? "cut" as Transition : undefined,
        generation: { targetDurationMs, requiresImageGeneration: true, requiresVideoGeneration: true },
      });
      cursorMs += dur;
    }

    // Invariants
    if (scenes.length > 0) {
      if (scenes[0].startMs !== 0) warnings.push("first scene does not start at 0");
      if (scenes[scenes.length - 1].endMs !== narrationDurationMs) warnings.push("final scene does not cover narration end");
    }

    const timelineCoverageDurationMs = scenes.reduce((s, sc) => s + sc.durationMs, 0);
    const timelineCoverageRatio = narrationDurationMs > 0 ? timelineCoverageDurationMs / narrationDurationMs : 0;
    const estimatedGeneratedVideoDurationMs = scenes.length * profile.preferredClipDurationMs;
    const generatedVisualCoverageRatio = narrationDurationMs > 0 ? estimatedGeneratedVideoDurationMs / narrationDurationMs : 0;
    const requiredVideoClipCount = Math.ceil(narrationDurationMs / profile.preferredClipDurationMs);

    const timelineId = `timeline-${createHash("sha256").update(JSON.stringify({
      plannerVersion: this.id,
      script: normalizeScript(script),
      narrationDurationMs,
      preferredClipDurationMs: profile.preferredClipDurationMs,
      maxClipDurationMs: profile.maxClipDurationMs,
      allowPeople,
      allowTalkingHead,
      culturalContext,
      visualStyle: input.visualStyle,
    })).digest("hex").slice(0, 12)}`;

    return {
      timelineId,
      status: "completed",
      narrationDurationMs,
      timelineCoverageDurationMs,
      timelineCoverageRatio,
      estimatedGeneratedVideoDurationMs,
      generatedVisualCoverageRatio,
      requiredVideoClipCount,
      // Legacy aliases
      plannedVisualDurationMs: timelineCoverageDurationMs,
      coverageRatio: timelineCoverageRatio,
      sceneCount: scenes.length,
      characters,
      scenes,
      warnings,
      generationSummary: {
        imageCount: scenes.length,
        videoClipCount: scenes.length,
        estimatedGeneratedVideoDurationMs,
      },
      generationProfile: profile,
      timingSource: "estimated_from_total_duration",
      plannerVersion: this.id,
    };
  }
}
