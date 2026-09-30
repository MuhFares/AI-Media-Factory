import { mkdir, writeFile } from "node:fs/promises";
import { buildBriefImagePrompt, buildBriefNegativePrompt, buildSceneVisualBrief, evaluatePreWanImage, validateSceneVisualBrief } from "@ai-media-factory/tool-framework";

const contentId = "content-cairo-everyday-life-v2";
const script = "ورا المعالم الشهيرة في القاهرة، شوارع كتير شكلت حياتنا وثقافتنا من أجيال. في الأسواق المزدحمة، محلات صغيرة عاملة على الرصيف، باعة، عجل، وموتوسيكلات. دي هي الحكايات اللي مخبية قدام عينينا. إنت شفتها؟";
const segments = [
  "ورا المعالم الشهيرة في القاهرة،",
  "شوارع كتير شكلت حياتنا وثقافتنا من أجيال.",
  "في الأسواق المزدحمة، محلات صغيرة عاملة على الرصيف، باعة، عجل،",
  "وموتوسيكلات. دي هي الحكايات اللي مخبية قدام عينينا.",
  "إنت شفتها؟",
];

const briefs = segments.map((narrationSegment, index) => {
  const sceneId = `scene-${String(index + 1).padStart(3, "0")}`;
  const brief = buildSceneVisualBrief(sceneId, narrationSegment, index, segments.length, "authentic contemporary Cairo everyday street documentary", "Egyptian Cairo");
  const validationErrors = validateSceneVisualBrief(brief);
  if (validationErrors.length) throw new Error(`${sceneId}: ${validationErrors.join("; ")}`);
  return {
    sceneId,
    narrationSegment,
    intendedVisualMeaning: `${brief.semanticSubject}; ${brief.primaryAction}`,
    requiredElements: brief.requiredElements,
    forbiddenElements: brief.forbiddenElements,
    imagePrompt: buildBriefImagePrompt(brief),
    negativeConstraints: buildBriefNegativePrompt(brief),
    wanMotionIntent: brief.motionIntent,
    visualBrief: brief,
    preWanGate: evaluatePreWanImage(),
  };
});

const artifact = {
  schemaVersion: "visual-direction-v2.local.1",
  contentId,
  sourceScript: script,
  narrationPreservedExactly: briefs.map((brief) => brief.narrationSegment).join(" ") === script,
  groundingArtifact: "docs/e2e-v2/cairo-visual-grounding-v2.md",
  historicalFailedVideo: "output/full-content-e2e-v2/content-cairo-everyday-life-v2/editing/content-cairo-everyday-life-v2-final-edited.mp4",
  providerCalls: { agentRouter: 0, research: 0, voiceTut: 0, zImage: 0, wan: 0, flux: 0 },
  regenerationAuthorized: false,
  notes: [
    "Local reconstruction only; no provider was called.",
    "The historical failed assets are regression evidence and are not reused.",
    "Each pre-Wan result is HUMAN_REVIEW_REQUIRED because reliable local OCR/layout inspection is unavailable.",
  ],
  scenes: briefs,
};

const outputPath = "output/full-content-e2e-v2/content-cairo-everyday-life-v2/visual-direction-v2/visual-briefs.json";
await mkdir(outputPath.slice(0, outputPath.lastIndexOf("/")), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, contentId, sceneCount: briefs.length, providerCalls: artifact.providerCalls }, null, 2));
