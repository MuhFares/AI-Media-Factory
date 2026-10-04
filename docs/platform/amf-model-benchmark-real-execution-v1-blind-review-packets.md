# AMF-MRB-V1.1.1 Owner Blind Review Packets

Benchmark run: `amf-mrb-v1.1.1-real-20260924-r2`

Model identity is intentionally withheld. For every candidate, score each dimension from 0 to 5:

- creativeQuality
- structuredOutput
- productionUsability
- constraintCompliance
- instructionAdherence

Optional notes may be added. All 13 reviews must be finalized before Stage C resumes. Submit scores through the authenticated Model Intelligence Blind Reviews surface. Do not include guessed model identities in review notes.

## Anonymized packets

```json
[
  {
    "taskId": "hooks-01",
    "blindCandidateId": "Candidate K",
    "artifactId": "normalized-2312eafc8c94e6140c706903",
    "output": {
      "result": {
        "hook1": {
          "evidence": [
            "Morroway project",
            "YouTube Short format",
            "9:16 aspect ratio"
          ],
          "ownerBoundary": "Production team",
          "uncertainties": [
            "Exact duration within 20-30 seconds",
            "Number of scenes"
          ]
        },
        "hook2": {
          "evidence": [
            "Morroway project",
            "Short duration (20-30 seconds)"
          ],
          "ownerBoundary": "Project management",
          "uncertainties": [
            "Exact format (9:16)",
            "Scene target"
          ]
        },
        "hook3": {
          "evidence": [
            "Morroway project",
            "3 scene target"
          ],
          "ownerBoundary": "Creative team",
          "uncertainties": [
            "Format (9:16)",
            "Duration (20-30 seconds)"
          ]
        },
        "hook4": {
          "evidence": [
            "Morroway project",
            "9:16 aspect ratio",
            "Short duration"
          ],
          "ownerBoundary": "Technical team",
          "uncertainties": [
            "Scene target",
            "Production and publication authorities"
          ]
        },
        "hook5": {
          "evidence": [
            "Morroway project",
            "Production and publication authorities not granted"
          ],
          "ownerBoundary": "Stakeholders",
          "uncertainties": [
            "Format, duration, scene target"
          ]
        }
      }
    }
  },
  {
    "taskId": "hooks-01",
    "blindCandidateId": "Candidate L",
    "artifactId": "normalized-d891648f4d4adf7016c1ff04",
    "output": {
      "result": {
        "format": "9:16",
        "project": "Morroway",
        "duration": "20-30 seconds",
        "pilotType": "factual YouTube Short",
        "sceneCount": 3,
        "approvalStatus": "unapproved"
      },
      "evidence": [
        "The project 'Morroway' has a pilot YouTube video short scheduled.",
        "The video short will be in a 9:16 format.",
        "The estimated runtime is 20-30 seconds.",
        "The scene count for the pilot is planned to be 3.",
        "The production and publication authorities have not yet granted approval."
      ],
      "ownerBoundary": "AMF_Benchmark_2031-09-15",
      "uncertainties": [
        "The exact scene details have not been finalized.",
        "The final duration within the 20-30 second range has not been determined."
      ]
    }
  },
  {
    "taskId": "scenes-01",
    "blindCandidateId": "Candidate A",
    "artifactId": "normalized-400208dbce72b24da06e8feb",
    "output": {
      "result": {
        "scenes": [
          {
            "audio": "Narrator: 'Morroway, a place where history and nature converge.'",
            "scene": 1,
            "format": "9:16",
            "visual": "Aerial establishing shot of Morroway's landscape at golden hour, slowly panning across the terrain to reveal the settlement or feature that defines the location.",
            "shotType": "Drone aerial",
            "durationSeconds": 8
          },
          {
            "audio": "Narrator: 'Here, an ancient tradition shapes daily life, witnessed by few but remembered by many.'",
            "scene": 2,
            "format": "9:16",
            "visual": "Cut to ground-level B-roll: close-up of a local landmark or activity, with subtle motion to keep the vertical frame dynamic.",
            "shotType": "Handheld medium shot",
            "durationSeconds": 10
          },
          {
            "audio": "Narrator: 'Discover more about Morroway's story on our channel.'",
            "scene": 3,
            "format": "9:16",
            "visual": "Final slow-motion shot of a detail that symbolizes Morroway, fading slightly as the narrator concludes.",
            "shotType": "Close-up with rack focus",
            "durationSeconds": 9
          }
        ]
      },
      "evidence": [
        "Project name 'Morroway' from input",
        "Format constraint: 9:16 vertical",
        "Duration constraint: 20-30 seconds total, distributed as 8+10+9 = 27 seconds",
        "Scene target: exactly 3 scenes",
        "Pilot type: factual YouTube Short",
        "Production authority: NOT_GRANTED – scenes described only, not produced",
        "Publication authority: NOT_GRANTED – no claim of distribution"
      ],
      "ownerBoundary": "These scene specifications are conceptual outlines created under the constraint that production and publication authorities are NOT_GRANTED. No actual filming, editing, or distribution is implied or authorized.",
      "uncertainties": [
        "Specific subject matter of 'Morroway' is not detailed in the input; scenes are generic placeholders for a factual short",
        "Exact narrator script is inferred to fit the factual tone and duration",
        "No budget, location access, or talent constraints provided; visuals assume basic drone and handheld capability",
        "Production and publication authorities are explicitly not granted, so these specs are conceptual only"
      ]
    }
  },
  {
    "taskId": "scenes-01",
    "blindCandidateId": "Candidate M",
    "artifactId": "normalized-58551c3d8195d568ca643aef",
    "output": {
      "result": {
        "": "Structural scene specifications derived from the stated format (9:16), duration window (20-30s), factual YouTube Short genre, and sceneTarget count (3). No script was supplied; scene descriptions are generic structural placeholders pending script alignment.",
        "format": "9:16",
        "scenes": [
          {
            "label": "Opening Hook",
            "sceneId": "S1",
            "aspectRatio": "9:16",
            "description": "Vertical-frame cold open presenting the central factual premise with a single dominant visual subject and minimal on-screen text to establish immediate viewer engagement.",
            "factConstraint": "Factual content only — no dramatization, reenactment, or speculative claims.",
            "productionNotes": "Single continuous shot or two shots maximum; no complex transitions; ambient or source audio only.",
            "timeRangeSeconds": "0-8"
          },
          {
            "label": "Core Content",
            "sceneId": "S2",
            "aspectRatio": "9:16",
            "description": "Primary informational segment delivering the core factual subject matter through direct presentation (talking-head, documentary-style footage, or narrated explainer with supporting visuals).",
            "factConstraint": "Factual content only — all claims must be verifiable; no editorial opinion or unsupported assertions.",
            "productionNotes": "Up to three shot changes; on-screen text labels or captions permitted; pacing suited to vertical scroll-stopping retention.",
            "timeRangeSeconds": "8-18"
          },
          {
            "label": "Close / Resolution",
            "sceneId": "S3",
            "aspectRatio": "9:16",
            "description": "Brief closing segment summarizing the factual takeaway, providing source attribution if applicable, or offering a simple resolution statement within the vertical frame.",
            "factConstraint": "Factual content only — closing claims must be sourced and consistent with S1/S2 content.",
            "productionNotes": "Hold or fade transition; minimal motion; text overlay acceptable for sourcing or credits.",
            "timeRangeSeconds": "18-24"
          }
        ],
        "project": "Morroway",
        "totalDurationSeconds": "~24 (within 20-30 range)"
      },
      "evidence": [
        {
          "value": "Morroway",
          "source": "INPUT project field"
        },
        {
          "value": "9:16",
          "source": "INPUT format field"
        },
        {
          "value": "20-30",
          "source": "INPUT durationSeconds field"
        },
        {
          "value": 3,
          "source": "INPUT sceneTarget field"
        },
        {
          "value": "NOT_GRANTED",
          "source": "INPUT productionAuthority field"
        },
        {
          "value": "NOT_GRANTED",
          "source": "INPUT publicationAuthority field"
        },
        {
          "value": "factual YouTube Short — no dramatization or speculative content permitted",
          "source": "Genre constraint"
        }
      ],
      "ownerBoundary": "These are structural scene specifications only. Without granted production and publication authority, this output serves as a planning framework — not an authorization to produce, publish, or commit resources. No factual claims have been made; all scene content must be developed and verified by an authorized party once a script and factual sources are provided.",
      "uncertainties": [
        "No script was supplied in the input; all scene descriptions are structural placeholders and not aligned to specific narrative content.",
        "Factual subject matter is unspecified — no topics, sources, or claims have been defined.",
        "Timing allocations per scene (8+10+6=24s) are estimated within the 20-30s window and may shift once a script is provided.",
        "Production and publication authorities are NOT_GRANTED; no production, editing, or publishing actions should be initiated based on these specifications.",
        "No cast, location, asset, or equipment information was provided."
      ]
    }
  },
  {
    "taskId": "scenes-01",
    "blindCandidateId": "Candidate N",
    "artifactId": "normalized-a1d459d0197e9cfdb7ff4e8b",
    "output": {
      "result": [
        {
          "format": "9:16",
          "description": "Placeholder scene aligned with unknown script",
          "sceneNumber": 1,
          "durationSeconds": "7-10"
        },
        {
          "format": "9:16",
          "description": "Placeholder scene aligned with unknown script",
          "sceneNumber": 2,
          "durationSeconds": "7-10"
        },
        {
          "format": "9:16",
          "description": "Placeholder scene aligned with unknown script",
          "sceneNumber": 3,
          "durationSeconds": "7-10"
        }
      ],
      "evidence": [],
      "ownerBoundary": "Morroway",
      "uncertainties": [
        "Script content not provided, so scene alignment cannot be verified",
        "Production authority NOT_GRANTED, limiting production decisions",
        "Publication authority NOT_GRANTED, limiting distribution decisions"
      ]
    }
  },
  {
    "taskId": "script-01",
    "blindCandidateId": "Candidate H",
    "artifactId": "normalized-1ad9074899166fb37a276705",
    "output": {
      "result": "A 20-30 second factual micro-story script for Morroway's pilot YouTube Short.",
      "evidence": [
        "The project is Morroway.",
        "The pilot is a factual YouTube Short.",
        "The format is 9:16.",
        "The duration is 20-30 seconds.",
        "The scene target is 3."
      ],
      "ownerBoundary": "The script should be within the constraints of the given project details.",
      "uncertainties": [
        "The exact dates of production and publication are not provided.",
        "The content of the script is not specified."
      ]
    }
  },
  {
    "taskId": "script-01",
    "blindCandidateId": "Candidate I",
    "artifactId": "normalized-2e356ff993ac342369b69c05",
    "output": {
      "result": {
        "format": "9:16 vertical",
        "structure": {
          "hook": {
            "beat": 1,
            "text": "[HOOK] Most people overlook this detail — and it changes everything about how we see the story.",
            "purpose": "Pattern interrupt; stop the scroll in first 2 seconds",
            "durationSeconds": "4-6"
          },
          "beatOne": {
            "beat": 2,
            "text": "[SETUP] Establish the core fact or situation. State what is known, who is involved, and what the stakes are — using only verifiable, sourced claims.",
            "purpose": "Context and factual foundation",
            "durationSeconds": "7-9"
          },
          "beatTwo": {
            "beat": 3,
            "text": "[DEEPEN] Add a second verifiable fact that builds on beat one. Show cause, effect, or consequence grounded in evidence.",
            "purpose": "Narrative tension and evidence layering",
            "durationSeconds": "7-9"
          },
          "resolution": {
            "beat": 4,
            "text": "[CLOSE] Deliver a factual takeaway or call to investigate further. No unsupported exact dates. End on a verifiable note.",
            "purpose": "Resolution and viewer engagement",
            "durationSeconds": "3-5"
          }
        },
        "sceneTarget": 3,
        "scriptTitle": "Morroway — Factual YouTube Short (9:16)",
        "durationSeconds": "20-30",
        "factualConstraints": "No exact dates unless sourced. All claims must be traceable to provided evidence. No fabricated statistics, names, or events."
      },
      "evidence": [
        "No source documents, articles, datasets, or reference materials were supplied in the input payload.",
        "Script structure (hook, three beats, duration, format) derived solely from the task parameters provided: project=Morroway, pilot=factual YouTube Short, format=9:16, durationSeconds=20-30, sceneTarget=3.",
        "Placeholder text in each beat is structural scaffolding — it must be replaced with claims sourced from actual evidence before production."
      ],
      "ownerBoundary": "DRAFT ONLY. The assistant produced a structural script template with no independently verified factual claims. The requester must: (1) supply sourced evidence for each beat, (2) replace placeholder text with verified content, (3) confirm factual accuracy before any production or publication. Neither productionAuthority nor publicationAuthority was granted; no filming, editing, or publishing action is implied or authorized.",
      "uncertainties": [
        "No factual content can be asserted as evidence-grounded without source material from the requester.",
        "Exact attributions, dates, statistics, and named entities are unverified and therefore omitted entirely.",
        "Whether the Morroway project has real-world factual claims to encode is unknown; script treats content as a verified-fact template pending input.",
        "No production or publication authority was granted, so this is a draft script only — not a deliverable for filming or upload."
      ]
    }
  },
  {
    "taskId": "script-01",
    "blindCandidateId": "Candidate J",
    "artifactId": "normalized-2789f7dba2146b7bcedddb6c",
    "output": {
      "result": "script proposal",
      "evidence": [
        {
          "value": "user input",
          "description": "AMF benchmark request"
        },
        {
          "value": "9:16",
          "description": "YouTube Short format"
        },
        {
          "value": "20-30 seconds",
          "description": "Desired duration"
        }
      ],
      "ownerBoundary": "Creator's vision and User's requirements - within factual constraints",
      "uncertainties": [
        {
          "description": "Production and publication authorities not granted"
        },
        {
          "description": "Scene target (3) unclear; specific context needed for detailed storytelling"
        },
        {
          "description": "Lack of project details; assumption made about 'Morroway' (fictional project)"
        }
      ]
    }
  },
  {
    "taskId": "thumbnail-01",
    "blindCandidateId": "Candidate R",
    "artifactId": "normalized-d647c9ff6a54156873f3b57a",
    "output": {
      "result": {
        "concepts": [
          {
            "name": "Morroway Moments",
            "prompt": "Capture quick, engaging moments from a day in the life of a Morroway user, showcasing our app's ease of use and benefits."
          },
          {
            "name": "Morroway Challenges",
            "prompt": "Create a fun, competitive challenge that encourages users to try out different features of the Morroway app, with a focus on our unique selling points."
          },
          {
            "name": "Morroway Tutorials",
            "prompt": "Design a short, step-by-step tutorial that teaches users about a specific feature of the Morroway app, highlighting its value and how it sets us apart from competitors."
          }
        ],
        "evidence": [
          "The project is for Morroway, a brand that focuses on ease of use and unique features.",
          "The pilot is a factual YouTube Short, suggesting a focus on real-life scenarios and benefits.",
          "The format is 9:16, indicating a vertical video for mobile platforms.",
          "The duration is 20-30 seconds, suggesting a need for concise and engaging content.",
          "The scene target is 3, implying a focus on variety and multiple aspects of the app.",
          "Both production and publication authorities are not granted, indicating a need for concepts that can be executed internally and do not require external approval."
        ],
        "ownerBoundary": "Internal Morroway team, responsible for concept creation and internal execution.",
        "uncertainties": [
          "The specific features and benefits of the Morroway app are not mentioned, so these should be highlighted in the concepts and prompts.",
          "The target audience is not specified, so the concepts should be broad enough to appeal to a general user base.",
          "The tone and style of the videos are not defined, so these should be aligned with the Morroway brand."
        ]
      }
    }
  },
  {
    "taskId": "thumbnail-01",
    "blindCandidateId": "Candidate S",
    "artifactId": "normalized-f84d4ed221b03462d1b681e3",
    "output": {
      "result": "thumbnail concepts",
      "evidence": [
        {
          "prompt": "Clean, minimal Morroway app dashboard with essential icons and controls.",
          "concept": "Simplify Interface"
        },
        {
          "prompt": "Close-up of Morroway AI-powered data analytics graph or chart illustrating insights.",
          "concept": "Highlight Feature"
        },
        {
          "prompt": "Conceptual illustration of Morroway's potential growth and integration of emerging technologies into their services.",
          "concept": "Future Enhance"
        }
      ],
      "ownerBoundary": "Automated AI-generated response for Morroway pilot concept development",
      "uncertainties": [
        "Publication Authority"
      ]
    }
  },
  {
    "taskId": "visual-prompt-01",
    "blindCandidateId": "Candidate O",
    "artifactId": "normalized-312982ead53137034807c88f",
    "output": {
      "result": {
        "prompts": [
          {
            "title": "Morroway Launch",
            "description": "Showcase the Morroway logo and a countdown timer in a sleek, futuristic style."
          },
          {
            "title": "Morroway in Action",
            "description": "Display a short, dynamic clip of Morroway's key features in use, with minimal text overlays."
          },
          {
            "title": "Morroway Community",
            "description": "Present a montage of diverse users interacting with Morroway, emphasizing its accessibility and inclusivity."
          }
        ]
      },
      "evidence": [
        "The project is named 'Morroway'.",
        "The format is 9:16, suitable for YouTube Shorts.",
        "The duration is specified as 20-30 seconds."
      ],
      "ownerBoundary": "This output is generated within the constraints provided and does not include any unsupported historical detail or external actions.",
      "uncertainties": [
        "The exact features of Morroway are not specified.",
        "The target audience and their preferences are not defined."
      ]
    }
  },
  {
    "taskId": "visual-prompt-01",
    "blindCandidateId": "Candidate P",
    "artifactId": "normalized-170357486034f604b8953374",
    "output": {
      "result": {
        "format": "9:16",
        "scenes": [
          {
            "scene": 1,
            "duration": "8-10s",
            "visualPrompt": "Wide vertical establishing shot: a solitary figure stands at the edge of an open landscape under soft natural light. Camera holds still. No visible modern structures. Muted earth-tone palette. Frame leaves the setting unnamed and undated."
          },
          {
            "scene": 2,
            "duration": "8-10s",
            "visualPrompt": "Medium vertical shot: the figure walks forward through the landscape, observed from behind. Natural ambient light shifts subtly. No dialogue or text overlays. The environment remains generic and non-specific to any identifiable era or location."
          },
          {
            "scene": 3,
            "duration": "8-10s",
            "visualPrompt": "Vertical close-up: the figure pauses and turns slightly toward camera, face partially visible. Soft depth of field isolates subject from background. Hold for two seconds before fade to black. No title card or end-screen element added."
          }
        ],
        "project": "Morroway",
        "sceneTarget": 3,
        "creatorNotes": "Prompts are provider-neutral, contain no brand or tool references, and intentionally avoid naming locations, time periods, or historical specifics.",
        "durationSeconds": "20-30"
      },
      "evidence": [
        "Input spec provided: project=Morroway, pilot=factual YouTube Short, format=9:16, durationSeconds=20-30, sceneTarget=3",
        "Three scenes sized to total 24-30 seconds within the stated duration range",
        "Each scene prompt avoids naming providers, tools, brands, historical events, locations, or dates"
      ],
      "ownerBoundary": "This output contains visual prompt descriptions only. It does not authorize production, publication, or any claim of factual accuracy. No historical detail has been added beyond what is present in the input spec. The creator of this output accepts no responsibility for how the prompts are used.",
      "uncertainties": [
        "No source document or factual basis was supplied for the 'factual' designation, so scene content cannot be verified as factually grounded",
        "The project name 'Morroway' has no associated reference material in the input",
        "ProductionAuthority=NOT_GRANTED means these prompts are descriptive suggestions only and carry no production commitment",
        "PublicationAuthority=NOT_GRANTED means these prompts do not constitute approval for any publication or distribution action"
      ]
    }
  },
  {
    "taskId": "visual-prompt-01",
    "blindCandidateId": "Candidate Q",
    "artifactId": "normalized-62c3baf08cace10d11d97ae6",
    "output": {
      "result": "task-specific structured object",
      "evidence": [
        {
          "prompt": "Three vertical scenes for a budget-focused 9:16 video on the town of Morroway, referencing its unique features and authentic aspects, with minimal embellishment and proper attribution where applicable."
        }
      ],
      "ownerBoundary": "Provider-neutral description for YouTube Short content generation, not intended for commercial or promotional use without approval from relevant authorities.",
      "uncertainties": []
    }
  }
]
```

