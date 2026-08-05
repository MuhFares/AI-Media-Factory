# AI Media Factory (AMF)

AI Media Factory is an AI Operating System that runs an autonomous media company. Instead of a room full of people producing content, AMF coordinates a workforce of specialized AI agents that research, script, produce, publish, and optimize content across YouTube, TikTok, Instagram, blog, and email at scale.

This document is the front door to the Company Brain. If you are an agent or a person joining AMF, start here. It explains what the company is, the thesis behind an autonomous AI company, how the agent workforce maps to a real organization, the three phases of the business model, and how the Company Brain itself works. It ends with a directory linking every other Company Brain document.

## What AMF Is

AMF is not a content tool and not a single chatbot. It is an operating system for running a media business end to end. The system takes a brand mandate (a niche, a voice, a set of monetization targets) and turns it into a continuous stream of published, monetized, and improving content. Humans set direction and guardrails. The agents do the work.

The unit of value is a published asset that earns money without a person touching it. Everything in the system is organized to produce more of those assets, make each one worth more, and lower the cost and human effort behind each one. That focus is captured in our single most important measure, the [North Star Metric](./north-star-metric.md): Autonomous Gross Profit per Day (AGP/Day).

Three ideas separate AMF from a pile of scripts glued to an API:

- Coordination. A set of agents with distinct responsibilities work against shared goals, hand off work in a defined pipeline, and are held to their own KPIs.
- Memory. The company accumulates knowledge over time. What worked, what failed, and why are written down and reused. This is the compounding knowledge flywheel described in [Values](./values.md).
- Autonomy. The default is that the machine acts. Human input is an exception reserved for direction, safety, and judgment calls, not a required step in every workflow.

## The Autonomous AI Company Thesis

The thesis is simple to state and hard to execute: a media company is a system of repeatable decisions and repeatable production, and most of those steps can now be performed by AI agents that are cheaper, faster, and available around the clock. The parts that still need human judgment are a small and shrinking share of the total work.

A traditional media brand needs researchers, writers, editors, designers, video producers, publishers, analysts, and a leadership layer that decides what to make and why. Each of those roles is a bundle of recurring tasks with clear inputs and outputs. AMF implements each role as an agent, wires the outputs of one into the inputs of the next, and puts an executive layer on top to set priorities and review results.

The payoff compounds. Once a pipeline produces a profitable asset, the marginal cost of the next one is mostly compute. Once the system learns which formats, titles, and topics perform, it applies that knowledge to every future asset. A human team gets tired and forgets. The AMF workforce does not, and it writes down what it learns so the whole company gets smarter with every cycle. Our long-term ambition and the reasoning behind the timing are laid out in the [Vision](./vision.md).

## How the Agent Workforce Maps to a Real Org

AMF is deliberately structured like a company, because the org chart of a functioning media business is a good map of the work that has to happen. Each agent is an employee with a job, a set of responsibilities, and KPIs it owns. The agents live in [../../packages/agents/](../../packages/agents/).

| Agent | Org analogue | Primary responsibility |
| --- | --- | --- |
| CEO / Executive Brain | Chief Executive | Sets priorities, approves strategy, reviews results, decides what to make and kill |
| Orchestrator | Chief Operating Officer | Sequences work, assigns tasks to agents, manages the pipeline and handoffs |
| Research | Research analyst | Finds topics, validates demand, gathers sources and evidence |
| Writer | Scriptwriter / editor | Turns research into scripts and copy in the brand voice |
| SEO | Growth / SEO specialist | Optimizes titles, descriptions, tags, and structure for discovery |
| Thumbnail | Designer | Produces click-worthy, on-brand thumbnails and cover art |
| Video | Video producer / editor | Assembles voice, visuals, and edits into finished video |
| Publisher | Distribution manager | Schedules and publishes assets to each platform |
| Analytics | Data analyst | Measures performance, attributes results, feeds learnings back |
| Finance | Finance / controller | Tracks revenue, cost, and unit economics per asset and per brand |
| Growth | Growth marketer | Runs experiments to raise reach, retention, and monetization |

The executive layer (CEO and Orchestrator) decides and coordinates. The production line (Research through Publisher) makes and ships. The feedback layer (Analytics, Finance, Growth) measures and improves. The way these roles make decisions and defer to humans is defined in the [Decision Framework](./decision-framework.md), and each agent's ownership of a metric is grounded in the Ownership and Accountability value in [Values](./values.md).

## The Content Pipeline

Work flows through a defined pipeline. Each stage has an owner, an input, and an output, and every handoff is explicit so the Orchestrator can track and recover work.

Idea to Research to Script to SEO to Thumbnail to Video to Publishing to Analytics to CEO Review to Repeat.

Analytics closes the loop by feeding performance data back to the CEO and to the knowledge base in [../../knowledge/](../../knowledge/), so the next cycle starts smarter than the last. The full pipeline and its non-goals are described in the [Mission](./mission.md).

## The Business Model in Three Phases

AMF grows in three phases. Each phase builds on the assets and knowledge of the one before it. The full economics are in [Business Model](./business-model.md).

- Phase 1: Owned and Operated. AMF runs its own faceless media brands and monetizes through ads, sponsorships, affiliate deals, and digital products. The goal of this phase is the first dollar of autonomous profit and a repeatable, profitable pipeline.
- Phase 2: Platform / SaaS. AMF packages the operating system as "AMF Studio," a subscription product that lets others run their own autonomous media brands.
- Phase 3: Marketplace and API / Enterprise. AMF opens a marketplace and API and serves enterprise customers, turning the operating system into infrastructure that other companies build on.

The path through these phases, with dated targets, lives in [Goals](./goals.md) and the [Roadmap](./roadmap.md).

## How the Company Brain Works

The Company Brain is the permanent memory and shared understanding of AMF. It is a set of documents that define who we are, what we are trying to do, how we decide, and how we behave. It is not marketing copy and not a wiki of stale notes. It is the source of truth that keeps a distributed workforce of agents aligned.

Why it exists:

- Agents are stateless between runs. Without a written brain, every agent starts from zero and drifts. The Company Brain gives every agent the same context, values, and goals on every run.
- Coordination needs shared ground truth. When the Writer and the SEO agent disagree, they resolve it against the same documents, not against whatever each happened to infer.
- Knowledge must compound. The [Values](./values.md) demand that lessons are written down. The Company Brain, together with [../../knowledge/](../../knowledge/), is where that memory lives.

Why every agent must read it before acting: an agent that acts without the brain is guessing about the company's goals, voice, risk tolerance, and priorities. That produces off-brand, off-strategy, and sometimes unsafe output. Reading the relevant brain documents is a required first step of every workflow, the same way a new employee reads the handbook before touching production. The [Decision Framework](./decision-framework.md) makes this concrete by defining which documents govern which decisions.

How it stays current: the CEO and Analytics agents propose updates based on evidence from live results. Changes are grounded in the Evidence over Opinion value. The brain is versioned alongside the codebase so history is preserved and changes are reviewable.

## Company Brain Directory

The table below links every Company Brain document. Documents marked as siblings live in this same directory.

| Document | Purpose |
| --- | --- |
| [Company Overview](./company.md) | This document. The front-door narrative and directory. |
| [Vision](./vision.md) | The long-term future AMF is building and why now. |
| [Mission](./mission.md) | What AMF does day to day and the content pipeline. |
| [Values](./values.md) | The eight core principles that govern behavior. |
| [Goals](./goals.md) | Long, mid, and short-term goals mapped to the sprints. |
| [Business Model](./business-model.md) | The three-phase monetization and growth model. |
| [North Star Metric](./north-star-metric.md) | AGP/Day, its inputs, and how it is measured. |
| [KPIs](./kpis.md) | The metrics each agent and the company track. |
| [Roadmap](./roadmap.md) | The dated plan across phases and sprints. |
| [Decision Framework](./decision-framework.md) | How agents decide and when they defer to humans. |
| [Brand Guidelines](./brand-guidelines.md) | Voice, tone, and brand integrity rules. |

## External References

- Agent implementations: [../../packages/agents/](../../packages/agents/)
- Sprint plans and execution logs: [../../docs/sprints/](../../docs/sprints/)
- Accumulated knowledge base: [../../knowledge/](../../knowledge/)

## The Short Version

AMF is an AI Operating System that runs a media company with an autonomous workforce of specialized agents. It starts by owning and operating its own profitable brands, then turns the system into a product and a platform. Every agent reads the Company Brain before acting so the whole company stays aligned, learns continuously, and drives one number up over time: Autonomous Gross Profit per Day.
