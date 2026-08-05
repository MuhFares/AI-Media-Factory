# Agents

The `agents` package is the multi-agent "digital company" layer of AI Media Factory (AMF). It models an autonomous media business as a coordinated set of specialist agents, each responsible for a distinct function of the operation. Every agent reads the [Company Brain](../../memory/company/README.md) before acting.

No application logic lives here. This package defines **contracts and documentation only** — the standardized structure below is the specification that implementation will later satisfy.

## The digital company metaphor

The package is organized as an org chart. The **CEO / Executive Brain** sets strategy and makes decisions but never executes. The **Orchestrator** turns decisions into coordinated, event-driven execution. Specialist agents own a single domain each. Two cross-cutting agents — **QA** and **Brand** — act as quality and brand-safety gates across the whole pipeline.

## Standard agent structure

Every agent folder conforms to the same enterprise structure so agents are predictable, testable, and swappable:

```
<agent>/
  README.md                    # the agent contract (see below)
  config/
    README.md                  # folder purpose
    config.yaml                # declarative config: model, tools, budgets, guardrails, escalation
  prompts/
    README.md                  # folder purpose
    system.md                  # the agent's system prompt / role definition
    instructions.md            # step-by-step operating procedure
    examples.md                # few-shot on-brand examples
  memory/
    README.md                  # folder purpose
    long_term.md               # durable knowledge (vector-backed), what persists across runs
    short_term.md              # working context for the current run
  schemas/
    input.schema.json          # the event/command this agent consumes (JSON Schema draft-07)
    output.schema.json         # the event this agent emits (JSON Schema draft-07)
  workflows/
    workflow.md                # how the agent executes within the event-driven pipeline
  tests/
    README.md                  # folder purpose
    evaluation.md              # eval methodology, metrics, pass thresholds
    scenarios.md               # concrete input/expected-behavior scenarios
```

Every `README.md` explains, in this order: **Mission, Responsibilities, KPIs, Inputs, Outputs, Collaborations, Decision Authority, Escalation Rules.**

## Inter-agent contract (the event envelope)

Agents do not call each other directly. They exchange **events** over the event bus, coordinated by `apps/orchestrator`. Every `input.schema.json` and `output.schema.json` shares one envelope so any agent can validate any message:

| Field | Type | Purpose |
|---|---|---|
| `schema_version` | string | Contract version (currently `1.0.0`) |
| `event_id` | uuid | Unique id of this event |
| `workflow_id` | uuid | Correlates every event in one pipeline run |
| `correlation_id` | string | Optional cross-workflow trace id |
| `brand_id` | string | Which owned brand this concerns |
| `asset_id` | string \| null | The content asset, once one exists |
| `timestamp` | date-time | Emission time (UTC) |
| `type` | enum | The event type (e.g. `ResearchFinished`) |
| `source_agent` | string | Emitting agent id |
| `target_agent` | string | Intended consumer, or `orchestrator` |
| `payload` | object | Agent-specific body (differs per agent) |
| `metadata` | object | Cost, model, latency, and trace annotations |

The `payload` is where agents differ; the envelope is identical everywhere. This is what makes the pipeline composable: the `ResearchFinished` event emitted by `research` is exactly the `WriterStarted` input consumed by `writer`.

### The primary event flow

```
CEO(Directive) -> Orchestrator -> Research -> Writer -> SEO -> Thumbnail -> Video
   -> [Brand + QA gates] -> Publisher -> Analytics -> Finance -> CEO Review -> repeat
```

Brand and QA are gates that any production stage can route through before an asset advances; Finance and Growth run alongside and feed the CEO review.

## Orchestration

Agents are orchestrated by `apps/orchestrator`, expected to build on LangGraph, CrewAI, and the Model Context Protocol (MCP). The `orchestrator` agent here describes the execution contract that application implements.

## Agent roster

| Agent | Layer | Responsibility |
| --- | --- | --- |
| `ceo` | Executive | Sets strategy and priorities, reviews results, decides what to make and kill. Decisions only. |
| `orchestrator` | Execution | Executes event-driven workflows, routes tasks, manages retries and hand-offs. |
| `research` | Production | Discovers and validates topics, trends, and source material. |
| `writer` | Production | Produces scripts and copy from research briefs, in brand voice. |
| `seo` | Production | Optimizes titles, descriptions, tags, and structure for discovery. |
| `thumbnail` | Production | Designs and generates click-optimized thumbnail and cover imagery. |
| `video` | Production | Assembles, edits, and renders finished video assets. |
| `publisher` | Production | Schedules and distributes finished content across platforms. |
| `analytics` | Feedback | Measures performance and reports insights back to the company. |
| `finance` | Feedback | Tracks budgets, costs, and unit economics; guards margin. |
| `growth` | Feedback | Runs acquisition and retention experiments to scale reach. |
| `qa` | Gate | Validates output quality and schema conformance before an asset advances. |
| `brand` | Gate | Enforces brand voice, safety, and compliance on every published asset. |

## Related documents

- [Company Brain](../../memory/company/README.md) — the business truth every agent must read
- [Decision Framework](../../memory/company/decision-framework.md) — decision gates and escalation
- [KPIs](../../memory/company/kpis.md) — per-agent metric ownership
- Event-driven architecture: [docs/architecture](../../docs/architecture/README.md)
