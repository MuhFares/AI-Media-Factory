/**
 * MORROWAY VISUAL ITERATION DRAFT — agent-drafted creative proposal.
 *
 * Provenance: NOT canonical creative direction. Drafted transparently for
 * OWNER prompt review (APPROVE_FOR_GENERATION / REQUEST_PROMPT_ITERATION /
 * REJECT). Creative authority: OWNER_REVIEW_REQUIRED.
 *
 * Evidence grounding (no invention beyond these):
 *  - exact script spans: canonical Writer artifact
 *    art-wf-1789233193749-gvydpiah-writer-20260914T083233986Z (via Director
 *    narrationSegments, R8 lineage)
 *  - brand: MORROWAY Threshold identity (cinematic, mysterious, amber/shadow)
 *  - RCA grammar §9: hands / silhouette / over-shoulder / desk / manuscripts /
 *    research cards / paper / lamplight (no sustainable face identity on the
 *    current provider stack; no demographics inferred from language)
 *  - policy: TEXT FORBIDDEN / UI FORBIDDEN (paper as texture-only objects)
 *
 * Structural guarantees are machine-checked (validator + compiler + prompt
 * length within the 1000-char adapter contract + deterministic seeds).
 */

const SPANS = {
  "scene-001": "بتبحث في التاريخ عشان تكتب قصتك، وخايف المعلومات تزهّق القارئ؟",
  "scene-002": "ده السؤال اللي بيقدّم له فيديو «How to Research Your Story Without Info-Dumping».",
  "scene-003": "القاعدة الذهبية: اختار المعلومة اللي تخدم المشهد وتقدّم الحكاية، وسيّب الباقي.",
  "scene-004": "لو جزء من البحث مبيخدمش المشهد ولا بيكسّر الإيقاع، احذفه من النص؛ تقدر تخليه في ملف بحث منفصل لو محتاجه بعدين.",
  "scene-005": "الخلاصة: ما تحطّش كل اللي عرفته؛ اروي بس اللي لازم القارئ يعرفه هنا.",
};

const NO_FACE = ["face", "screen", "cartoon", "glamour portrait", "ui", "swimwear"];

function scene(sceneId, narrativePurpose, subject, action, setting, shotType, composition, mustInclude, extraBans = []) {
  return {
    sceneId,
    sourceScriptSpan: SPANS[sceneId],
    narrativePurpose,
    subject,
    characterIds: [],
    action,
    setting,
    era: "present night",
    shotType,
    cameraAngle: "eye level, slight side angle",
    composition,
    lighting: "warm desk lamp against cool dark",
    emotion: "quiet focus",
    wardrobe: [],
    mustInclude,
    mustNotInclude: [...NO_FACE, "text", ...extraBans],
    textPolicy: "FORBIDDEN",
    uiPolicy: "FORBIDDEN",
  };
}

export function buildMorrowayIterationDraft() {
  const scenes = [
    scene(
      "scene-001", "establish the writer dilemma: too much research, fragile story",
      "over-shoulder silhouette at a lamplit desk facing two paper piles",
      "a hand hovering between a manuscript stack and a taller research-note stack",
      "night study with bookshelves dissolved in shadow",
      "medium wide over-shoulder", "desk foreground, twin paper piles, dark shelves behind",
      ["manuscript pages", "research notes", "desk lamp"],
    ),
    scene(
      "scene-002", "pose the guiding question: research serving story",
      "desk tableau of research tools beside one blank story card",
      "fingers sliding a brass seal from a magnifier toward the blank card",
      "same lamplit desk seen closer, amber rim light",
      "close detail", "tools left, blank card right, hand mid-frame",
      ["magnifier", "blank card", "brass seal"], ["phone", "app", "readable letters"],
    ),
    scene(
      "scene-003", "state the golden rule: keep only the serving detail",
      "a single manuscript page lifted above scattered notes",
      "a hand raising the chosen page into lamplight while other pages blur",
      "same desk, shallow depth, night",
      "shallow-focus close", "one sharp page center, soft blurred notes around",
      ["single page", "soft blur"],
    ),
    scene(
      "scene-004", "demonstrate the cut: archive the non-serving research",
      "an archive box with a blank wax seal beside the desk",
      "hands closing the lid and sliding the box aside out of frame",
      "same study, cooler edge of lamplight",
      "medium side angle", "box left closing, clear desk space opening right",
      ["archive box", "wax seal"],
    ),
    scene(
      "scene-005", "resolve: narrate only what the reader needs now",
      "a pen resting above one written line on plain paper",
      "a hand finishing the line, pen lifting, ink catching lamplight",
      "same desk in calmer darker frame, night settling",
      "intimate close", "paper foreground, pen mid-lift, darkness behind",
      ["pen", "plain paper"],
    ),
  ];
  return {
    provenance: {
      authority: "agent-drafted",
      ownerReview: "REQUIRED",
      basis: [
        "art-wf-1789233193749-gvydpiah-writer-20260914T083233986Z",
        "art-wf-1789233193749-gvydpiah-brand-20260914T083233986Z",
        "art-wf-1789233193749-gvydpiah-review-20260914T124232118Z",
        "art-wf-1789233193749-gvydpiah-director-20260914T124232118Z",
        "R8 visual failure RCA (five incoherent outputs; no demographic inference)",
      ],
      characterPolicy: "no recurring visible face; hands/silhouette grammar only",
    },
    contract: {
      version: 2,
      contentId: "2b0f94c8-7a11-4b69-8c31-3d2c45f8a7e1",
      storyVisualIdentity: {
        visualMode: "photoreal_cinematic",
        realismLevel: "photoreal, natural materials, honest low-key texture",
        cinematicLanguage: "Threshold: amber against abyssal dark",
        world: "one lamplit writer study adjoining imagined historical strata",
        era: "present night with timeless paper textures",
        locationLanguage: "lived-in desk, shelves dissolved in shadow",
        lightingLanguage: "warm practical lamp against cool dark",
        colorLanguage: "abyssal base with restrained threshold amber",
        textureLanguage: "paper grain, wood, brass, wax",
        cameraLanguage: "35mm, shallow depth, motivated stillness",
        motionLanguage: "implied stillness; no lip movement",
      },
      globalContinuity: {
        mustRemainConsistent: ["photoreal rendering", "same lamplit desk world", "hands/silhouette grammar", "amber/shadow lighting"],
        allowedVariation: ["camera distance", "which desk zone is framed", "night hour"],
        forbiddenStyleShifts: ["cartoon", "anime", "3d render", "glamour portrait", "ui screen", "swimwear", "editorial portrait"],
      },
      characters: [],
      worldRules: [
        "no recurring visible face; identity carried by hands, silhouette, and objects",
        "paper and manuscripts appear as texture-only objects, never readable",
        "no screens, devices, or interface objects anywhere",
        "no anachronistic devices; brass, wax, paper, wood only",
      ],
      forbiddenVisualModes: ["animated_family", "stylized_illustration", "editorial_portrait"],
      defaultTextUiPolicy: { textPolicy: "FORBIDDEN", uiPolicy: "FORBIDDEN" },
      scenes,
    },
  };
}
