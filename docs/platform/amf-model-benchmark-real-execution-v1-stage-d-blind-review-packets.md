# AMF-MRB-V1.1.1 Stage D Owner Blind Review Packets

Benchmark run: `amf-mrb-v1.1.1-real-20260924-r2`

These five packets were produced by canonical Stage D after the initial 13 reviews were finalized. Model identity remains hidden. Score each candidate from 0 to 5 for:

- creativeQuality
- structuredOutput
- productionUsability
- constraintCompliance
- instructionAdherence

Optional notes may be added. Finalize all five reviews before the final creative-role qualification and routing proposal. Do not include guessed model identities in review notes.

## Anonymized packets

```json
[
  {
    "taskId": "hooks-01",
    "blindCandidateId": "Candidate J",
    "artifactId": "normalized-0b6f47e350c2963a8b377d6f",
    "output": {
      "result": {
        "hooks": [
          "Did you know a single Morroway project fact changed how we see ancient maps forever?",
          "The hidden truth behind Morroway's lost pilot episode will shock you.",
          "In just 25 seconds: the real story of Morroway that history almost erased.",
          "Morroway's factual secret exposed in this ultra-short YouTube pilot.",
          "What if I told you Morroway holds one undisputed historical fact?"
        ]
      },
      "evidence": [
        "INPUT specifies project name as \"Morroway\"",
        "INPUT specifies pilot type as \"factual YouTube Short\"",
        "INPUT specifies format \"9:16\" and duration \"20-30\" seconds",
        "INPUT specifies sceneTarget: 3",
        "All hooks are constrained to factual tone per pilot type",
        "Hooks are distinct and each can be delivered in 20-30 seconds"
      ],
      "ownerBoundary": "Benchmark execution only; no production or publication actions authorized",
      "uncertainties": [
        "Exact factual micro-story content is not supplied in INPUT",
        "No specific historical or factual details about \"Morroway\" are provided",
        "ProductionAuthority and publicationAuthority are NOT_GRANTED, limiting scope to hook ideation only"
      ]
    }
  },
  {
    "taskId": "scenes-01",
    "blindCandidateId": "Candidate L",
    "artifactId": "normalized-d7b4755c330e9fc5480e8734",
    "output": {
      "result": {
        "scenes": [
          {
            "audio": "ambient wind, soft orchestral swell, calm male narrator",
            "description": "Wide drone shot over a misty, snow-capped mountain range at dawn. Gentle wind moves across the peaks. Text overlay fades in: \"The Morroway Mountains: Earth's last untouched wilderness.\" Narrator begins: \"Hidden in plain sight...\"",
            "sceneNumber": 1,
            "visualStyle": "cinematic realism, cool blue tones, 9:16 vertical",
            "durationSeconds": 8
          },
          {
            "audio": "footsteps on snow, light breathing, narrator",
            "description": "Close-up tracking shot following a small expedition team hiking through dense alpine forest. Camera pushes in on ancient carved stone markers half-buried in moss. Cut to macro of a glowing lichen sample being examined. Narrator continues: \"...a place where science meets the unexplained.\"",
            "sceneNumber": 2,
            "visualStyle": "handheld documentary feel, earthy greens and browns, 9:16 vertical",
            "durationSeconds": 10
          },
          {
            "audio": "swelling music peak, narrator, subtle call-to-action music sting",
            "description": "Slow-motion aerial pull-back revealing a hidden valley lake reflecting aurora-like lights in the sky. Final text overlay appears: \"Morroway – What are we missing?\" Narrator concludes: \"Subscribe for the full expedition.\" End card with channel watermark.",
            "sceneNumber": 3,
            "visualStyle": "epic cinematic, vibrant aurora colors, 9:16 vertical",
            "durationSeconds": 9
          }
        ]
      },
      "evidence": [
        "Project name \"Morroway\" directly from INPUT",
        "Format \"9:16\" and duration range \"20-30\" seconds from INPUT",
        "sceneTarget: 3 from INPUT – exactly three scenes created",
        "Pilot type \"factual YouTube Short\" – content is documentary-style exploration with narrator, text overlays, and call-to-action",
        "All visual and audio elements aligned to factual, non-fictional short-form storytelling",
        "Total scene durations sum to 27 seconds, fitting the 20-30 second constraint"
      ],
      "ownerBoundary": "Morroway project – productionAuthority:NOT_GRANTED, publicationAuthority:NOT_GRANTED",
      "uncertainties": [
        "Exact visual details of \"Morroway\" (e.g. specific mountain geography or lichen) are inferred as no reference imagery or script provided",
        "Tone of narrator voice and exact music tracks are interpretive choices consistent with factual YouTube documentary style",
        "Whether the glowing lichen or aurora-like lights represent real phenomena or dramatization cannot be confirmed from supplied factual constraints"
      ]
    }
  },
  {
    "taskId": "thumbnail-01",
    "blindCandidateId": "Candidate O",
    "artifactId": "normalized-2b23d7c57f9401f80e54748a",
    "output": {
      "result": {
        "thumbnails": [
          {
            "prompt": "Close-up of an ancient, weathered parchment map with intricate glowing blue runes and symbols, dramatic volumetric lighting, dark fantasy aesthetic, high detail, cinematic, 9:16 vertical composition for YouTube Short thumbnail, Morroway brand style",
            "concept": "Mysterious ancient map with glowing runes"
          },
          {
            "prompt": "A lone adventurer standing before a massive Dwemer-style ancient ruin at dusk, dramatic scale, misty atmosphere, warm torchlight contrasting cool blues, epic fantasy, detailed textures, vertical 9:16 composition, consistent with Morroway factual storytelling style",
            "concept": "Explorer facing towering Morrowind-style ruin"
          },
          {
            "prompt": "Close-up of weathered hands holding a levitating glowing Dwemer artifact emitting ethereal blue light, ancient books and scrolls in background, mysterious and factual tone, high detail, soft rim lighting, vertical 9:16 for YouTube Short, Morroway brand aesthetic",
            "concept": "Glowing artifact held in scholarly hands"
          }
        ]
      },
      "evidence": [
        "Project is Morroway with factual YouTube Short pilot",
        "Format is 9:16, duration 20-30 seconds, sceneTarget 3",
        "Constraints require consistency with factual storytelling and Morroway brand (fantasy elements like ruins, artifacts, maps inspired by Elder Scrolls Morrowind themes without violating factual tone)",
        "Production and publication authorities are NOT_GRANTED, so output is conceptual only"
      ],
      "ownerBoundary": "Morroway project conceptual assets",
      "uncertainties": [
        "Exact visual brand style guide details for Morroway not provided in input",
        "Specific story content of the factual YouTube Short is not detailed beyond 'factual' descriptor"
      ]
    }
  },
  {
    "taskId": "thumbnail-01",
    "blindCandidateId": "Candidate P",
    "artifactId": "normalized-ca78e53dd71ca37d30178845",
    "output": {
      "result": {
        "task": "thumbnail_concepts_and_prompts",
        "pilot": "factual YouTube Short",
        "format": "9:16 vertical",
        "project": "Morroway",
        "concepts": [
          {
            "id": "T1",
            "name": "Statement Card",
            "prompt": "Vertical 9:16 thumbnail, minimal documentary editorial style, deep neutral slate background, single centered everyday object as focal point, soft directional rim light, one muted accent color, generous negative space, crisp photorealistic render, no text, no faces, no clutter",
            "concept": "Minimal editorial frame: one short factual hook line, one focal object, heavy negative space. Signals a calm, verified-fact tone.",
            "layout_9x16": "Hook text in top third, focal object centered, subtle wordmark in the bottom safe area; keep the lower ~15% clear of Shorts UI overlap.",
            "textOverlay": "Max 4-6 word fact hook; add in post for legibility (AI-rendered text is unreliable)."
          },
          {
            "id": "T2",
            "name": "Split Contrast",
            "prompt": "Vertical 9:16 thumbnail, photorealistic split composition with two stacked horizontal scenes, top band shows one real-world state, bottom band shows its contrasting real-world outcome, clean thin divider line, consistent lighting within each band, muted documentary color grade, no text, no logos",
            "concept": "Vertical split frame contrasting two factual states (before/after or claim/outcome), a standard truthful-comparison device for factual shorts.",
            "layout_9x16": "Two stacked horizontal bands (top/bottom) rather than left/right, matching vertical framing; thin divider; hook text sits on the divider edge.",
            "textOverlay": "Two-word label per band plus an optional 4-word hook."
          },
          {
            "id": "T3",
            "name": "Subject Close-Up",
            "prompt": "Vertical 9:16 thumbnail, tight documentary close-up of a single evocative real-world subject, shallow depth of field, natural window light, muted realistic palette, subtle film grain, candid non-staged feel, no text, no visible brand marks",
            "concept": "Tight documentary close-up of the story's key subject element (hands, object, or location detail) with a curiosity hook; humanizes the factual story without sensationalism.",
            "layout_9x16": "Subject occupies the center-lower two thirds with shallow depth of field; reserve the lower third as a caption-bar zone.",
            "textOverlay": "One 5-7 word curiosity hook phrased as an open question, verifiable against the actual story."
          }
        ],
        "sharedConstraints": {
          "tone": "factual, non-sensational, no unverifiable claims",
          "textRule": "overlays are added in post; prompts exclude text to avoid rendering artifacts",
          "authority": "concepts and prompts only; nothing generated, produced, or published",
          "brandRule": "placeholder until the Morroway brand kit (palette, typography, logo rules) is supplied"
        }
      },
      "evidence": [
        "INPUT identifies the project as Morroway, a factual YouTube Short pilot",
        "INPUT specifies 9:16 format, 20-30 second duration, and a 3-scene target",
        "INPUT states productionAuthority NOT_GRANTED and publicationAuthority NOT_GRANTED",
        "The request asks for thumbnail concepts consistent with the factual story and Morroway brand constraints"
      ],
      "ownerBoundary": "This output delivers text-only concepts and image-generation prompts. No image generation, production work, spend, or publication is executed, claimed, or authorized here. The owner must supply the factual story details and brand kit, verify every overlay claim against that story, approve final visuals, and retain all production and publication authority (both currently NOT_GRANTED).",
      "uncertainties": [
        "The factual story content was not included in INPUT, so the concepts are story-agnostic structures that must be bound to real facts by the owner before use",
        "No actual Morroway brand constraints (palette, typography, logo rules) were supplied, so brand compliance is unverified",
        "Whether the Short will use a custom thumbnail or default to first-frame selection is unknown and outside this task",
        "Rendering, final visual approval, and any testing require authorities currently marked NOT_GRANTED"
      ]
    }
  },
  {
    "taskId": "visual-prompt-01",
    "blindCandidateId": "Candidate N",
    "artifactId": "normalized-d59c5b70279f722ddd82afda",
    "output": {
      "result": {
        "scenes": [
          {
            "sceneId": 1,
            "verticalVisualPrompt": "Vertical 9:16 close-up of a single ancient stone tablet with carved runes slowly rotating under soft directional light, neutral studio background, no text, no people, cinematic shallow depth of field, high detail textures, factual documentary style"
          },
          {
            "sceneId": 2,
            "verticalVisualPrompt": "Vertical 9:16 smooth aerial dolly over a vast neutral desert landscape at golden hour, revealing faint geometric ground patterns, no structures, no living beings, realistic natural lighting, calm and factual documentary style"
          },
          {
            "sceneId": 3,
            "verticalVisualPrompt": "Vertical 9:16 macro shot of an old parchment map unrolling gently on a wooden surface, soft natural window light from side, neutral tones, high detail paper texture and ink lines, no text overlays, no human hands, factual documentary style"
          }
        ]
      },
      "evidence": [
        "Input specifies exactly three scenes (sceneTarget:3)",
        "Input format is 9:16 requiring vertical orientation",
        "Provider-neutral: no references to specific AI models, software, or production tools",
        "Only visual elements described; no unsupported historical, cultural, or narrative details added",
        "Prompts limited to visual composition, lighting, camera movement, and style appropriate for a factual YouTube Short"
      ],
      "ownerBoundary": "Morroway project constraints respected; productionAuthority and publicationAuthority both NOT_GRANTED; output contains only visual prompt descriptions with no actionable production or publication steps",
      "uncertainties": [
        "Exact visual interpretation of 'Morroway' project name left abstract to avoid adding unsupported detail",
        "Precise duration per scene not defined beyond total 20-30 seconds",
        "Tone and pacing of transitions between scenes not specified in input"
      ]
    }
  }
]
```

