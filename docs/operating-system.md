# AI Media Factory Operating System

**Version:** 1.0  
**Date:** 2026-08-04  
**Classification:** Internal — Confidential  
**Owner:** Chief Technology Officer  

---

# Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Company Brain — The Strategic Core](#2-company-brain--the-strategic-core)
3. [Executive Brains — The Decision Layer](#3-executive-brains--the-decision-layer)
4. [Agent Runtime — The Execution Layer](#4-agent-runtime--the-execution-layer)
5. [Workflow Engine — The Orchestration Layer](#5-workflow-engine--the-orchestration-layer)
6. [Event Bus — The Nervous System](#6-event-bus--the-nervous-system)
7. [Provider Layer — The Intelligence Layer](#7-provider-layer--the-intelligence-layer)
8. [Prompt Compiler — The Assembly Layer](#8-prompt-compiler--the-assembly-layer)
9. [Context Engine — The Decision Layer](#9-context-engine--the-decision-layer)
10. [Memory Engine — The Knowledge Layer](#10-memory-engine--the-knowledge-layer)
11. [Tool Framework — The Action Layer](#11-tool-framework--the-action-layer)
12. [Evaluation Framework — The Quality OS](#12-evaluation-framework--the-quality-os)
13. [Dashboards & Observability](#13-dashboards--observability)
14. [Human Approval Gates](#14-human-approval-gates)
15. [Company KPIs & North Star](#15-company-kpis--north-star)
15. [Continuous Learning Loop](#16-continuous-learning-loop)
16. [User Request Journey — End-to-End](#17-user-request-journey--end-to-end)
17. [Architecture Diagrams](#18-architecture-diagrams)
18. [Responsibility Maps](#19-responsibility-maps)
19. [Operational Lifecycle](#20-operational-lifecycle)
19. [Glossary](#21-glossary)

---

# 1. Executive Summary

AI Media Factory (AMF) is an **autonomous AI media company** that operates as a coordinated system of specialized AI agents. The company produces, publishes, and optimizes content across YouTube, TikTok, Instagram, blog, and email channels with minimal human intervention.

**Core Thesis:** Media production is bottlenecked by human labor. By replacing human workflows with autonomous AI agents coordinated through an event-driven architecture, AMF achieves near-zero marginal cost per content unit, enabling profitable operation at infinite scale.

**North Star Metric:** **Autonomous Gross Profit per Day (AGP/Day)** — gross profit generated per day requiring zero human intervention.

**Business Model Evolution:**
- **Phase 1 (0-12 months):** Owned & Operated — AMF runs its own faceless media brands
- **Phase 2 (12-24 months):** Platform/SaaS — "AMF Studio" subscription for creators/agencies
- **Phase 3 (3-5 years):** Marketplace & Enterprise — Agent marketplace, API, managed brands

---

# 2. Company Brain — The Strategic Core

## 2.1 Purpose
The **Company Brain** is the permanent, version-controlled source of truth for the entire organization. It is the "institutional memory" that every agent reads before making decisions.

## 2.2 Location
`memory/company/` — 18 documents, version-controlled, never git-ignored.

## 2.3 Contents

| Document | Purpose |
|---|---|
| `company.md` | Master overview — who we are, how the brain works |
| `vision.md` | 3-5 year and 10-year vision |
| `mission.md` | Daily mission and operating thesis |
| `values.md` | 8 core values with anti-patterns |
| `goals.md` | Short/mid/long-term goals mapped to sprints |
| `business-model.md` | 3-phase model, Business Model Canvas |
| `revenue-model.md` | 8 revenue streams, path to $100M ARR |
| `customer-personas.md` | 5 personas (Chris, Ana, Marcus, Priya, Elena) |
| `target-market.md` | TAM/SAM/SOM, beachhead strategy |
| `products.md` | 6 products mapped to repo structure |
| `pricing.md` | 5 tiers + credit system |
| `competitive-advantages.md` | 6 moats + competitive landscape |
| `brand-guidelines.md` | Voice, visual identity, quality bar |
| `decision-framework.md` | Decision gates, RICE/ICE, risk register |
| `north-star-metric.md` | AGP/Day definition, drivers, anti-gaming |
| `kpis.md` | Full KPI tree + per-agent ownership |
| `roadmap.md` | Phases, sprints, 3-5 year horizon |
| `glossary.md` | 60+ defined terms |

## 2.4 Governance
- **Read Protocol:** Every agent MUST read `company.md` + relevant sections before acting
- **Update Policy:** Changes via reviewed PRs; strategic changes recorded as Decision Records
- **Single Writer:** CEO agent owns write access; others read-only

---

# 3. Executive Brains — The Decision Layer

## 3.1 CEO Agent (Executive Brain)
**Role:** Strategic decision-maker only. Never executes.

| Responsibility | KPI |
|---|---|
| Review company performance | Portfolio ROI |
| Analyze revenue & costs | Gross margin |
| Decide priorities & budget | AGP/Day trend |
| Suggest new brands/niches | New brand viability |
| Decide hiring (new agents) | Agent ROI |
| Analyze competitors | Competitive win rate |
| Review KPIs weekly | KPI trajectory |
| Generate executive reports | Report quality |

**Decision Authority:** One-way doors only (brand launch, niche entry, agent hiring, pricing). Never executes.

## 3.2 Orchestrator Agent (Execution Brain)
**Role:** Execution engine. Receives objectives from CEO, coordinates agents.

| Responsibility | KPI |
|---|---|
| Decompose objectives into steps | Throughput |
| Dispatch tasks to agents | Dispatch latency |
| Manage retries & dead-letter | Recovery rate |
| Control workflow execution | Autonomy rate |
| Manage checkpoints | Recovery time |

**Decision Authority:** Two-way doors only (routing, retries, scheduling). Escalates one-way doors to CEO.

---

# 4. Agent Runtime — The Execution Layer

## 4.1 Architecture
```
packages/runtime/ — Generic, agent-agnostic execution engine
```

## 4.2 Responsibilities
| Capability | Description |
|---|---|
| Load agent config | Parse `config.yaml` (model, tools, budgets, guardrails) |
| Load prompts | System, instructions, examples |
| Load memories | Short-term + long-term from Memory Engine |
| Load schemas | Input/output JSON Schema validation |
| Build execution context | Assemble immutable ExecutionContext |
| Receive input event | Consume from Event Bus |
| Validate input schema | SchemaValidator against `input.schema.json` |
| Execute LLM | Via Provider Layer (unified interface) |
| Validate output schema | SchemaValidator against `output.schema.json` |
| Save memories | Persist to Memory Engine |
| Emit next event | Publish to Event Bus |
| Produce logs | Structured, correlation-keyed |
| Produce metrics | Latency, tokens, cost, success |
| Support retries | Exponential backoff, max 3 |
| Support checkpoints | Write-ahead via Memory Engine |
| Human approval gates | Pause for approval gates |
| Cancellation | Cooperative cancellation tokens |
| Timeout enforcement | Per-step + per-turn deadlines |
| Cost tracking | Per-turn cost attribution |

## 4.3 Agent Contract (Per Agent)
Each agent in `packages/agents/` has 12 files:
```
README.md                    # Mission, KPIs, inputs, outputs, dependencies, authority, escalation
config/config.yaml           # Model, tools, budgets, guardrails
prompts/system.md            # System prompt
prompts/instructions.md      # Step-by-step operating procedure
prompts/examples.md          # Few-shot examples
memory/long_term.md          # Durable knowledge
memory/short_term.md         # Working context
schemas/input.schema.json    # Input event schema
schemas/output.schema.json   # Output event schema
workflows/workflow.md        # Execution flow in workflow
tests/evaluation.md          # Eval methodology, metrics, thresholds
tests/scenarios.md           # Concrete test scenarios
```

## 4.4 The 13 Agents
| Agent | Layer | Responsibility |
|---|---|---|
| CEO | Executive | Strategy, priorities, portfolio, hiring |
| Orchestrator | Execution | Workflow execution, routing, retries |
| Research | Production | Topic discovery, demand validation |
| Writer | Production | Scripts, copy, brand voice |
| SEO | Production | Titles, descriptions, tags, structure |
| Thumbnail | Production | Click-optimized thumbnails |
| Video | Production | Assembly, editing, rendering |
| Publisher | Production | Scheduling, multi-platform distribution |
| Analytics | Feedback | Performance measurement, attribution |
| Finance | Feedback | Cost tracking, margin, budgets |
| Growth | Feedback | Experiments, A/B tests, audience growth |
| QA | Gate | Technical quality, schema conformance |
| Brand | Gate | Voice, safety, compliance |

---

# 5. Workflow Engine — The Orchestration Layer

## 5.1 Responsibility
Owns **execution state** of workflows. Coordinates agents via events. Never executes agents directly.

## 5.2 State Machine (10 States)
```
PENDING → RUNNING → PAUSED/AWAITING_APPROVAL/RETRYING/COMPENSATING → COMPLETED/FAILED/CANCELLED/ESCALATED
```

## 5.3 Step Model (5 Kinds)
| Step | Purpose |
|---|---|
| `AgentStep` | Run agent via Runtime |
| `BranchStep` | Conditional branching (predicate on context) |
| `ParallelStep` | Fan-out + join |
| `GateStep` | Human approval gate |
| `CompensationStep` | Saga rollback |

## 5.4 Scheduler
- **Sequential:** Default spine (Research → Writer → SEO → Thumbnail → Video → QA → Brand → Publisher)
- **Parallel:** Fan-out (SEO + Thumbnail in parallel after Writer)
- **Join:** Wait for all parallel branches

## 5.5 Resilience
| Mechanism | Details |
|---|---|
| Retry | 3 attempts, exponential backoff (1s/4s/16s) |
| Checkpoint | Write-ahead at every state boundary via Memory Engine |
| Recovery | Replay from checkpoint, idempotent (dedupe by event_id) |
| DLQ | Non-recoverable → Dead Letter Queue + EscalationRequired event |
| Compensation | Saga rollback in reverse order on failure/cancel |

---

# 6. Event Bus — The Nervous System

## 6.1 Principle
**Agents never call each other directly.** All coordination via events.

## 6.2 Event Envelope (Shared)
```json
{
  "schema_version": "1.0.0",
  "event_id": "uuid",
  "workflow_id": "uuid",
  "correlation_id": "string",
  "brand_id": "string",
  "asset_id": "string",
  "timestamp": "ISO-8601",
  "type": "EventType",
  "source_agent": "agent_id",
  "target_agent": "agent_id",
  "payload": {},
  "metadata": { "cost_usd": 0.0, "model": "...", "latency_ms": 0 }
}
```

## 6.3 Event Chain (Production Pipeline)
```
ExecutiveDirective → TaskDispatched(research) → ResearchFinished
→ TaskDispatched(writer) → ScriptFinished
→ TaskDispatched(seo) + TaskDispatched(thumbnail) [PARALLEL]
  → SEOFinished + ThumbnailFinished (JOIN)
→ TaskDispatched(video) → VideoFinished
→ TaskDispatched(qa) → QAReviewed (PASSED/FAILED)
  → TaskDispatched(brand) → PublishApproved
    → TaskDispatched(publisher) → PublishingFinished
      → AnalyticsReported → FinanceReported + GrowthProposed
        → CEOReviewRequested → ExecutiveDirective (next cycle)
```

## 6.4 System Events
| Event | Purpose |
|---|---|
| `WorkflowStarted` | Workflow begins |
| `WorkflowSucceeded` | Workflow completes |
| `WorkflowFailed` | Terminal failure |
| `CheckpointCreated` | State boundary persisted |
| `EscalationRequired` | CEO/human intervention needed |
| `DeadLettered` | Event exhausted retries |
| `EscalationRequired` | CEO intervention required |

---

# 7. Provider Layer — The Intelligence Layer

## 7.1 Unified Interface (`LlmProvider`)
```typescript
interface LlmProvider {
  generate(request, signal): Promise<GenerateResponse>
  stream(request, signal): AsyncIterable<StreamChunk>
  embed(request, signal): Promise<EmbeddingResponse>
  supports(model): boolean
  describe(model): ModelCapabilities
  health(): Promise<HealthState>
}
```

## 7.2 Supported Providers (6)
| Provider | Models | Strengths |
|---|---|---|
| OpenAI | GPT-4o, GPT-4o-mini, embeddings | General purpose, structured output |
| Anthropic | Claude 3.5 Sonnet, Haiku | Reasoning, long context |
| Gemini | 1.5 Pro, Flash, embeddings | Large context, multimodal |
| OpenRouter | 100+ models | Gateway, fallback, breadth |
| DeepSeek | DeepSeek-V3, Coder | Cost-efficient reasoning |
| Mistral | Large, Nemo, embeddings | Open weights, multilingual |

## 7.3 Routing Intelligence
```
Request → Capability Filter → Health Filter → Rate-Limit Filter → Selection Strategy
                                                              ↓
                                    CostAware / LatencyAware / Balanced
                                                              ↓
                                         Fallback Chain (cross-vendor)
```

---

# 8. Prompt Compiler — The Assembly Layer

## 8.1 Responsibility
Assembles the **final LLM prompt** in canonical 9-section order. Runtime never builds prompts directly.

## 8.2 Assembly Order (Immutable)
| Order | Section | Source | Required |
|---|---|---|---|
| 1 | System | `prompts/system.md` | Yes |
| 2 | Company Brain | `memory/company/` | Yes |
| 3 | Agent Brain | `packages/agents/{agent}/brain.md` | Yes |
| 4 | Workflow Context | `WorkflowContext` | Yes |
| 5 | Memory | `MemoryEngine.retrieve()` | Yes |
| 6 | Examples | `prompts/examples.md` | No |
| 7 | Task | `RuntimeInput.event` | Yes |
| 8 | Output Schema | `schemas/output.schema.json` | Yes |
| 9 | Safety | Config + Brand Guidelines | Yes |

## 8.3 Token Budget
| Section | % of Prompt | Priority | Flexible |
|---|---|---|---|
| Safety | 5% | 100 | No |
| System | 5% | 90 | No |
| Output Schema | 5% | 80 | No |
| Company Brain | 15% | 80 | Yes |
| Agent Brain | 10% | 80 | Yes |
| Workflow Context | 15% | 70 | Yes |
| Memory | 25% | 60 | Yes |
| Examples | 15% | 30 | Yes |

**Total:** 100% of `maxPromptTokens` (80% of context window). Safety/System/Schema **never trimmed**.

---

# 9. Context Engine — The Decision Layer

## 9.1 Responsibility
**Single authority** for what context an agent receives. Minimizes tokens, maximizes decision quality.

## 9.2 Pipeline
```
Request → Brain Selection → Context Selection → Ranking → Budget → Compression → Assembly → Cache
```

## 9.3 Brain Selection (Per Agent)
| Agent | Company | Agent | Workflow | Session | Examples |
|---|---|---|---|---|---|
| CEO | ✓ | ✓ | ✓ | ✓ | ✗ |
| Research | ✓ | ✓ | ✓ | ✓ | ✓ |
| Writer | ✓ | ✓ | ✓ | ✓ | ✓ |
| QA/Brand | ✓ | ✓ | ✓ | ✓ | ✗ |

---

# 10. Memory Engine — The Knowledge Layer

## 10.1 Eight Stores
| Store | Type | Owner | Durability |
|---|---|---|---|
| `session` | Ephemeral | Orchestrator | ~30d |
| `company` | Permanent | CEO | Permanent |
| `agent` | Durable + Ephemeral | Each Agent | Durable + Ephemeral |
| `analytics` | Rolling + Archived | Analytics | Rolling |
| `decision` | Permanent | CEO | Permanent |
| `workflow` | Run-scoped | Orchestrator | Run-scoped |
| `lessons` | Permanent | CEO + Agents | Permanent |
| `checkpoint` | Until Resumed | Orchestrator | Until Resumed |

## 10.3 Retrieval Pipeline
```
Query → Scope Filter → Candidate Fetch (Vector + Graph + Keyword)
  → Merge/Dedupe → Conflict Check → Rank → Confidence Gate → Budget Cap → Result
```

**Ranking:** `w1·Relevance + w2·Recency + w3·Performance + w4·Confidence − w5·Conflict`

## 10.4 Intelligence Layer
- **Confidence Scoring** — Evidence, corroboration, recency, outcome validation
- **Source Attribution** — Every write requires `sources[]` + `derived_by`
- **Conflict Resolution** — Scoped/newer/confidence wins; ties escalate
- **Lessons Engine** — Observe → Extract → Validate → Link → Score → Promote → Feedback

---

# 11. Tool Framework — The Action Layer

## 11.1 Principle
**Runtime never calls tools directly.** All execution through `ToolInvoker`.

## 11.1 Pipeline
```
Registry → Permissions → Approval → Auth → Sandbox → Invocation → Retry/Timeout → Validate → Result
```

## 11.2 Six Sandbox Levels
| Level | Isolation | Overhead |
|---|---|---|
| `none` | None | None |
| `process` | Process namespace | Low |
| `container` | Container + cgroups | Medium |
| `vm` | Full virtualization | High |
| `wasm` | WASM sandbox | Low |

## 11.2 Default Category Configs (14 Categories)
| Category | Timeout | Retries | Approval | Sandbox | Est. Cost |
|---|---|---|---|---|---|
| `web_search` | 30s | 3 | No | process | $0.01 |
| `api_call` | 60s | 3 | No | process | $0.001 |
| `file_operation` | 30s | 2 | Yes | container | $0.0001 |
| `code_execution` | 120s | 2 | Yes | container | $0.01 |
| `media_generation` | 180s | 2 | Yes | container | $0.50 |
| `code_execution` | 120s | 2 | Yes | container | $0.01 |

---

# 12. Evaluation Framework — The Quality OS

## 12.1 Continuous Evaluation Loop
```
Trigger → Collect → Evaluate → Decide → Act → Report → Learn
```

## 12.2 50+ Standard Metrics
| Category | Metrics |
|---|---|
| Agent | task_success_rate, avg_latency_ms, autonomy_rate, retry_rate |
| Provider | availability, latency_p95, error_rate, cost_per_1k |
| Workflow | success_rate, avg_duration, rework_rate, autonomy_rate |
| Prompt | token_efficiency, schema_compliance |
| Memory | retrieval_precision, recall, conflict_rate |
| Tool | success_rate, avg_latency, cost_per_call |
| Output | quality_score, schema_compliance, brand_safety |

## 12.3 Quality Gates (20+)
| Gate | Threshold | Action |
|---|---|---|
| Agent Success Rate ≥ 95% | Fail | Agent |
| Provider Availability ≥ 99.9% | Fail | Provider |
| Workflow Success ≥ 95% | Fail | Workflow |
| Output Brand Safety ≥ 99% | Block | Output |
| Schema Compliance ≥ 99% | Fail | Output |

## 12.4 Continuous Improvement Loop
```
Analyze → Propose → Review → Execute → Monitor → Rollback
    ↑                                                                  │
    └──────────── Learning Loop ──────────────────────────────────────┘
```
- Auto-proposes: parameter tuning, prompt optimization, model switch, workflow restructure
- Auto-approve low-risk; human review for high-risk
- Rollback on negative impact

---

# 13. Dashboards & Observability

## 13.1 Executive Dashboard (CEO Weekly)
| Section | Metrics |
|---|---|
| North Star | AGP/Day, trend |
| Drivers | Profitable assets/week, Revenue/asset, Cost/asset, Autonomy rate |
| Funnel | Impressions → CTR → Watch → Conversion → Revenue |
| Per-Brand | AGP/Day, engagement, top asset, trend |
| Signals | Predicted winners, predicted failures, anomalies, top insights |

## 13.2 Operational Dashboards
| Dashboard | Audience | Refresh |
|---|---|---|
| Executive | CEO/Leadership | Weekly |
| Operational | Engineering/Operations | Real-time |
| Financial | Finance/CEO | Daily |
| Quality | QA/Brand/CEO | Real-time |

---

# 14. Human Approval Gates

## 14.1 Gate Types
| Gate | Trigger | Approver | SLA |
|---|---|---|---|
| Brand Safety | QA/Brand reject | Human Operator | Immediate |
| CEO One-Way Door | New brand, pricing, agent hire | CEO | 24h |
| Budget Overrun | Finance alert | CEO | 4h |
| Safety Incident | Brand/Compliance | Human + CEO | Immediate |

## 14.2 Gate Protocol
1. Workflow pauses at gate → checkpoint written
2. `ApprovalRequest` emitted to Event Bus
3. Human reviews via dashboard/API
4. `ApprovalDecision` emitted → workflow resumes or escalates

---

# 15. Company KPIs & North Star

## 15.1 North Star Metric
**Autonomous Gross Profit per Day (AGP/Day)**
```
AGP/Day = (Profitable Assets/Day) × (Revenue/Asset − Cost/Asset) × Autonomy Rate
```

## 15.2 KPI Tree
```
NORTH STAR: AGP/Day
├── PROFIT (Margin Side)
│   ├── Revenue per Asset
│   ├── Cost per Asset
│   └── Gross Margin
├── THROUGHPUT (Volume Side)
│   ├── Profitable Assets/Week
│   ├── Publish Success Rate
│   └── Cycle Time (Idea→Publish)
└── AUTONOMY (Self-Running)
    ├── Autonomy Rate
    ├── Escalations/Run
    └── Recovery Rate
```

## 15.3 Phase Targets
| Phase | Sprint | AGP/Day | Autonomy |
|---|---|---|---|
| Pre-1 | — | < $0 | < 40% |
| Phase 1 | First Dollar | First $>0 | 40-60% |
| Phase 1→2 | Scale | $10s/day | 60-75% |
| Phase 2 | Multi-Brand + SaaS | $100s/day | 75-90% |
| Phase 3 | Full Autonomy + Marketplace | $1000s/day | >90% |

---

# 16. Continuous Learning Loop

## 16.1 The Flywheel
```
Produce → Publish → Measure → Learn → Improve → Produce Better
```

## 16.2 Three Nested Loops

| Loop | Cadence | Scope | Output |
|---|---|---|---|
| **Per-Workflow** | Minutes/hours | Single run | Immediate lesson, context update |
| **Per-Sprint** | Weekly | Sprint cohort | Playbook updates, ranking recalibration |
| **Per-Phase** | Quarterly | Portfolio + strategy | Strategy shifts, new agents, budget reallocation |

## 16.3 Learning Mechanisms
| Mechanism | Trigger | Output |
|---|---|---|
| Lessons Engine | Workflow completion | Validated lesson → Lessons Store |
| Confidence Reinforcement | Outcome validation | Confidence ↑/↓ |
| Ranking Recalibration | Sprint retrospective | Weight updates |
| Trend Detection | Trend analysis | New opportunity / risk alerts |

---

# 17. User Request Journey — End-to-End

## 17.1 Scenario
**User Input:** "Create a YouTube video about 'AI Agents for Small Business Marketing' for brand `brd-ai-tools`"

## 17.2 Journey Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         USER REQUEST JOURNEY                                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│  USER REQUEST   │  "Create YouTube video: AI Agents for SMB Marketing"
│  (API/CLI/UI)   │  brand: brd-ai-tools
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. EVENT BUS: ExecutiveDirective Received                                  │
│    • CEO receives directive, creates WorkflowInstance wf-20260804-001     │
│    • Pins definition version: content-pipeline v1.2                        │
│    • Emits WorkflowStarted event                                           │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. WORKFLOW ENGINE: State = PENDING → RUNNING                              │
│    • Builds WorkflowInstance (pinned to v1.2)                              │
│    • Scheduler: ready = [research]                                         │
│    • Emits TaskDispatched(research)                                        │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. RESEARCH AGENT TURN                                                     │
│    ┌─────────────────────────────────────────────────────────────────────┐  │
│    │ CONTEXT ENGINE: Build Context Package                               │  │
│    │   • Company Brain (vision, mission, north star, brand guidelines) │  │
│    │   • Agent Brain (research: role, KPIs, authority)                 │  │
│    │   • Workflow Context (topic, brand, empty outputs)                │  │
│    │   • Session Context (turnId, scratch, empty events)               │  │
│    │   • Memory: retrieve(topic="AI agents SMB marketing", topK=10)    │  │
│    │   • Budget: $4.50 ceiling, 128k context window                     │  │
│    │   • Prompt Compiler: assembles 9-section prompt                   │  │
│    └─────────────────────────────────────────────────────────────────────┘  │
│    • Runtime: AgentRuntime.run(input)                                    │
│    • Provider Layer: routes to OpenAI gpt-4o-mini (research tier)        │
│    • Tool Framework: web_search tool invoked (if needed)                │
│    • Output: ResearchFinished {brief, sources, keywords, angle}          │
│    • Memory Engine: checkpoint cp-001 (RESEARCH_DONE)                    │
│    • Event Bus: ResearchFinished emitted                                 │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. WRITER AGENT TURN                                                       │
│    • Context: + ResearchFinished output                                   │
│    • Writer Agent: generates 1,847-word script with hook                  │
│    • Output: ScriptFinished {script, hook, sections, citations}          │
│    • Checkpoint cp-002: SCRIPT_DONE                                       │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 5. PARALLEL BRANCH: SEO + THUMBNAIL (ParallelStep → Join)                  │
│    SEO Agent: title, meta, keywords, chapters → SEOFinished              │
│    Thumbnail Agent: concept, variants, CTR optimization → ThumbFinished  │
│    Join: both complete → Video step eligible                              │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 6. VIDEO AGENT TURN                                                        │
│    • Assembles script + thumbnail + assets → renders MP4                  │
│    • VideoFinished {asset_id, video_ref, duration, render_cost, captions} │
│    Checkpoint cp-004: VIDEO_DONE                                          │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 7. QA GATE (QA Agent)                                                      │
│    • Input: VideoFinished                                                 │
│    • Checks: schema, render integrity, duration, captions                 │
│    • Output: QAReviewed {passed: true, checks: {...}, severity: none}     │
│    • If FAILED → rework loop back to Video                                 │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 8. BRAND GATE (Brand Agent)                                                │
│    • Input: QAReviewed (must be passed: true)                             │
│    • Checks: brand-safety, citations, voice conformance, packaging       │
│    • Output: PublishApproved {approvals: {brand:true, qa:true},          │
│                brand_safety: {safe: true}, voice_conformance_score: 0.94} │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 9. PUBLISHER AGENT                                                         │
│    • Input: PublishApproved (both approvals true)                         │
│    • Uploads to YouTube (scheduled 09:00 UTC)                             │
│    • Output: PublishingFinished {asset_id, refs: [youtube], status}      │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 10. ANALYTICS + FINANCE + GROWTH (Fan-in)                                  │
│     Analytics: attributes revenue, metrics, writes lessons                │
│     Finance: computes P&L, cost/asset, margin, budget status             │
│     Growth: proposes experiments, detects trends                          │
│     All emit: AnalyticsReported, FinanceReported, GrowthProposed          │
└─────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 11. CEO REVIEW & NEXT CYCLE                                                │
│     • FinanceReported + GrowthProposed → CEOReviewRequested               │
│     • CEO: reviews AGP/Day, KPIs, makes ExecutiveDirective                │
│     • Directive → Orchestrator → next cycle begins                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 17.3 Key Metrics for This Run
| Metric | Value | Target |
|---|---|---|
| **Total Time** | 48.1s | < 45 min ✅ |
| **Total Cost** | $2.31 | ≤ $4.50 ✅ |
| **Autonomy Rate** | 100% | > 90% ✅ |
| **Quality Gates** | All PASSED | All PASS ✅ |
| **Asset Produced** | `ast-000123` | 1 asset ✅ |
| **Checkpoints** | 6 | 6 ✅ |
| **Lessons Promoted** | 2 | — |

---

# 18. Architecture Diagrams

## 18.1 System Overview
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AI MEDIA FACTORY OS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐      │
│  │   USER REQUEST   │    │   EXTERNAL API   │    │   SCHEDULED      │      │
│  │   (API/CLI/UI)   │    │   (Webhooks)     │    │   TRIGGERS       │      │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘      │
│           │                       │                       │                │
└───────────┼───────────────────────┼───────────────────────┼────────────────┘
            ▼                       ▼                       ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                      EVENT BUS (Kafka/Redis Streams)                 │
    └────────────────────────────────┬────────────────────────────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
    ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
    │ WORKFLOW      │        │   RUNTIME     │        │  EVENT BUS    │
    │ ENGINE        │        │ (Agent Turns) │        │ (Transport)   │
    │               │        │               │        │               │
    │ • State Mach  │        │ • Agent Turns │        │ • Publish     │
    │ • Scheduler   │        │ • Prompt Comp │        │ • Subscribe   │
    │ • Checkpoints │        │ • Provider    │        │ • DLQ         │
    │ • Compensation│        │ • Tool Frame  │        │ • Audit Log   │
    └───────┬───────┘        └───────┬───────┘        └───────┬───────┘
            │                        │                        │
            ▼                        ▼                        ▼
    ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
    │  MEMORY       │◄──────►│  PROVIDER     │◄──────►│  TOOL         │
    │  ENGINE       │        │  LAYER        │        │  FRAMEWORK    │
    │               │        │               │        │               │
    │ • 8 Stores    │        │ • 6 Providers │        │ • 14 Categories│
    │ • Retrieval   │        │ • Routing     │        │ • Sandbox     │
    │ • Intelligence│        │ • Fallback    │        │ • Auth        │
    │ • Lifecycle   │        │ • Metrics     │        │ • Approval    │
    └───────────────┘        └───────────────┘        └───────────────┘
            │                        │                        │
            ▼                        ▼                        ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    EVALUATION FRAMEWORK (Quality OS)                 │
    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐               │
    │  │ Metrics  │ │ Gates    │ │ Bench.   │ │ Regress. │               │
    │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘               │
    │       │            │            │            │                       │
    │       ▼            ▼            ▼            ▼                       │
    │  ┌──────────────────────────────────────────────────────────────┐   │
    │  │              CONTINUOUS IMPROVEMENT LOOP                      │   │
    │  │  Analyze → Propose → Review → Execute → Monitor → Rollback   │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    └─────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    DASHBOARDS & OBSERVABILITY                        │
    │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐       │
    │  │ Executive  │ │ Operational │ │ Financial │ │ Quality   │       │
    │  └────────────┘ └────────────┘ └────────────┘ └────────────┘       │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## 18.2 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW: USER REQUEST → PUBLISH                    │
└─────────────────────────────────────────────────────────────────────────────┘

USER REQUEST
    │
    ▼
┌─────────────────┐
│ EVENT BUS       │ ──► ExecutiveDirective
│ (Ingest)        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ WORKFLOW ENGINE │ ──► WorkflowStarted
│ (State Machine) │
└────────┬────────┘
         │
         ▼
    ┌─────────┐
    │ SCHEDULER │ ──► Ready Steps: [research]
    └────┬──────┘
         │
         ▼
┌─────────────────────┐
│ RUNTIME (per step)  │
│ ┌─────────────────┐ │
│ │ CONTEXT ENGINE  │ │ ──► ContextPackage (9 sections)
│ └────────┬────────┘ │
└─────────┼──────────┘
          │
          ▼
   ┌─────────────┐
   │ PROMPT      │ ──► FinalPrompt (9 sections)
   │ COMPILER    │
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │ PROVIDER    │ ──► GenerateResponse (text/stream/embed)
   │ LAYER       │
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │ TOOL        │ ◄──► ToolInvoker (if tools needed)
   │ FRAMEWORK   │
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │ VALIDATION  │ ──► SchemaValidator (output.schema.json)
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │ MEMORY      │ ──► save() → Checkpoint
   │ ENGINE      │
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐
   │ EVENT BUS   │ ──► *Finished event
   │ (Emit)      │
   └──────┬──────┘
          │
          ▼
    ┌──────────────┐
    │ WORKFLOW     │ ──► Next Step / Complete
    │ ENGINE       │
    └──────┬───────┘
           │
           ▼
    ┌─────────────────┐
    │ EVALUATION     │ ──► Metrics, Gates, Benchmarks, Regression
    │ FRAMEWORK      │
    └───────────────┘
```

---

## 18.3 Component Responsibility Matrix

| Component | Owns | Consumes | Produces |
|---|---|---|---|
| **User** | Request | — | `ExecutiveDirective` |
| **Event Bus** | Transport | All events | All events |
| **Workflow Engine** | Execution state, scheduling | `ExecutiveDirective`, `*Finished` events | `TaskDispatched`, `WorkflowSucceeded/Failed`, `CheckpointCreated` |
| **Runtime** | Agent turn execution | `TaskDispatched`, context | `*Finished` events, cost/metrics |
| **Prompt Compiler** | Prompt assembly | `PromptContext` | `FinalPrompt` |
| **Provider Layer** | LLM execution | `GenerateRequest` | `GenerateResponse` |
| **Tool Framework** | Tool execution | `ToolInvoker.invoke()` | `ToolResult` |
| **Context Engine** | Context assembly | `MemoryEngine.retrieve()`, `WorkflowContext` | `ContextPackage` |
| **Memory Engine** | Memory persistence | `save()`, `retrieve()` | `MemoryRecord`, `LoadedMemory` |
| **Tool Framework** | Tool execution | `ToolInvoker.invoke()` | `ToolResult` |
| **Evaluation Framework** | Quality measurement | Events, metrics | Scores, gates, reports |
| **Event Bus** | Transport | All | All |

---

# 19. Responsibility Maps

## 19.1 RACI Matrix

| Activity | CEO | Orchestrator | Runtime | Workflow Eng | Memory Eng | Context Eng | Provider Layer | Tool Framework | Eval Framework |
|---|---|---|---|---|---|---|---|---|---|
| **Strategy & Priorities** | **R/A** | I | I | I | I | I | I | I | C |
| **Workflow Execution** | I | **R/A** | R | **A** | C | C | C | C | I |
| **Agent Turn Execution** | I | I | **R/A** | C | C | R | R | R | I |
| **Prompt Assembly** | I | I | I | I | I | **R/A** | C | I | I |
| **LLM Provider Call** | I | I | R | I | I | I | **R/A** | I | I |
| **Tool Execution** | I | I | R | I | I | I | I | **R/A** | I |
| **Memory Read/Write** | I | I | R | R | **R/A** | R | I | R | R |
| **Context Assembly** | I | I | R | R | R | **R/A** | I | I | I |
| **Quality Gates** | A | I | C | R | C | C | I | I | **R/A** |
| **Checkpoint/Recovery** | I | I | C | **R/A** | **R** | C | I | I | I |
| **Budget/Margin** | A | I | C | C | R | I | I | C | **R/A** |
| **Approval Gates** | **A** | C | R | R | I | C | I | I | R |
| **Metrics/Reporting** | R | R | C | R | R | C | C | C | **R/A** |

**Legend:** R = Responsible, A = Accountable, C = Consulted, I = Informed

---

## 19.2 Data Ownership

| Data Domain | Owner | Readers | Writers |
|---|---|---|---|
| Company Brain | CEO | All | CEO only |
| Agent Brain | Agent | Agent, Orchestrator | Agent only |
| Workflow State | Workflow Engine | All | Workflow Engine |
| Session Memory | Orchestrator | Orchestrator, Agent | Orchestrator |
| Company Memory | CEO | All | CEO only |
| Agent Memory | Agent | Agent, Orchestrator | Agent only |
| Analytics Memory | Analytics | All | Analytics only |
| Decision Memory | CEO | All | CEO only |
| Lessons Learned | CEO + Agents | All | CEO, Agents |
| Checkpoints | Orchestrator | Orchestrator, Runtime | Orchestrator |
| Provider Metrics | Provider Layer | All | Provider Layer |
| Tool Metrics | Tool Framework | All | Tool Framework |

---

# 20. Operational Lifecycle

## 20.1 Deployment Pipeline
```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   COMMIT    │──►│    BUILD    │──►│   TEST      │──►│  DEPLOY     │──►│  VERIFY     │
│   (main)    │   │  (tsc/ESL)  │   │  (unit/int) │   │  (staging)  │   │  (health)   │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
                                                                       │
                                                                       ▼
                                                              ┌─────────────────┐
                                                              │  PRODUCTION     │
                                                              │  (canary → 100%)│
                                                              └─────────────────┘
```

## 20.2 Release Gates
| Gate | Criteria | Owner |
|---|---|---|
| **Build** | `tsc --noEmit` passes, ESLint clean | CI |
| **Test** | Unit > 80% coverage, integration pass | CI |
| **Security** | No secrets, dependency audit clean | Security |
| **Performance** | P95 latency < baseline + 10% | Perf |
| **Canary** | Error rate < 0.1%, latency P95 < baseline | SRE |
| **Full Rollout** | Canary stable 30 min | SRE + Eng Lead |

## 20.3 Incident Response
| Severity | Response Time | Escalation |
|---|---|---|
| **Critical** (P0) | 5 min | CEO + CTO + On-call |
| **High** (P1) | 30 min | On-call + Team Lead |
| **Medium** (P2) | 2 hr | On-call |
| **Low** (P3) | Next business day | Team |

---

# 21. Glossary

| Term | Definition |
|---|---|
| **AGP/Day** | Autonomous Gross Profit per Day — North Star metric |
| **Agent** | Specialized AI worker with defined role, config, prompts, memory |
| **AgentStep** | Workflow step that delegates to an agent via Runtime |
| **BranchStep** | Workflow step that conditionally chooses next path |
| **Checkpoint** | Durable workflow state snapshot for recovery |
| **ContextPackage** | Complete 9-section context package for an agent turn |
| **Dead Letter Queue** | Events that failed all retries |
| **Event Bus** | Central message backbone for agent coordination |
| **ExecutiveDirective** | CEO decision event emitted to Orchestrator |
| **GateStep** | Workflow step requiring human approval |
| **MemoryEngine** | Centralized memory storage and retrieval |
| **North Star** | AGP/Day — the single metric the company optimizes |
| **Orchestrator** | Workflow execution engine (agent) |
| **ParallelStep** | Workflow step that fans out multiple branches |
| **PromptCompiler** | Assembles final LLM prompt from 9 sections |
| **ProviderLayer** | Unified interface to 6+ LLM vendors |
| **Runtime** | Executes single agent turns via Provider Layer |
| **ToolFramework** | Safe tool execution with sandbox, auth, approval |
| **WorkflowEngine** | Owns workflow state, scheduling, checkpoints |
| **North Star** | AGP/Day — Autonomous Gross Profit per Day |

---

# Appendix: Quick Reference

## Key Files by Package
| Package | Key Files |
|---|---|
| `runtime` | `interfaces/runtime.ts`, `interfaces/execution.ts`, `src/providers/provider.ts` |
| `workflow-engine` | `core/engine.ts`, `execution/step-executor.ts`, `resilience/checkpoint.ts` |
| `prompt-compiler` | `core/compiler.ts`, `sections/ordering.ts`, `injection/*.ts` |
| `context-engine` | `core/engine.ts`, `selection/selector.ts`, `compression/compressor.ts` |
| `memory-engine` | `core/engine.ts`, `stores/*.ts`, `retrieval/pipeline.ts` |
| `tool-framework` | `core/tool.ts`, `execution/invocation.ts`, `gates/approval.ts` |
| `evaluation-framework` | `core/engine.ts`, `gates/gates.ts`, `improvement/improvement.ts` |
| `providers` | `core/provider.ts`, `registry/registry.ts`, `routing/router.ts` |
| `memory-engine` | `core/engine.ts`, `stores/*.ts`, `retrieval/pipeline.ts` |

## Key Events
| Event | Producer | Consumers |
|---|---|---|
| `ExecutiveDirective` | CEO | Orchestrator |
| `TaskDispatched` | Orchestrator | Runtime (per agent) |
| `ResearchFinished` | Research | Orchestrator → Writer |
| `ScriptFinished` | Writer | Orchestrator → SEO |
| `SEOFinished` | SEO | Orchestrator → Thumbnail |
| `ThumbnailFinished` | Thumbnail | Orchestrator → Video |
| `VideoFinished` | Video | Orchestrator → QA |
| `QAReviewed` | QA | Orchestrator → Brand |
| `PublishApproved` | Brand | Orchestrator → Publisher |
| `PublishingFinished` | Publisher | Orchestrator → Analytics |
| `AnalyticsReported` | Analytics | Orchestrator → Finance, Growth |
| `FinanceReported` | Finance | Orchestrator → CEO |
| `GrowthProposed` | Growth | Orchestrator → CEO |
| `ExecutiveDirective` | CEO | Orchestrator (next cycle) |

---

**End of Document**

---

*This document is the single source of truth for AI Media Factory's operating system architecture. All implementation must conform to the contracts and principles defined herein. Changes require Architecture Review Board approval.*