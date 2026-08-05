# AMF Business Model

AI Media Factory (AMF) is an AI Operating System that runs an autonomous media company. Instead of hiring editors, scriptwriters, thumbnail designers, and channel managers, AMF deploys specialized AI agents that produce and publish content across YouTube, TikTok, Instagram, blog, and email at scale. The orchestrator coordinates the agent workforce over an event bus, and the whole system is optimized toward a single number: **Autonomous Gross Profit per Day (AGP/Day)** — see [North Star Metric](./north-star-metric.md).

This document describes how AMF makes money, how the model evolves across three phases, and the economics that hold it together. For the stream-by-stream mechanics see [Revenue Model](./revenue-model.md); for tier pricing see [Pricing](./pricing.md); for the software surface see [Products](./products.md).

## The Core Thesis

Media businesses have historically been constrained by human labor. A single channel needs researchers, writers, voice talent, editors, and a publishing cadence that burns out teams. AMF removes the labor ceiling. Once an agent can research a topic, write a script, generate a voiceover, assemble a video, publish it, read the analytics, and feed that learning back into the next production, the marginal cost of an additional piece of content collapses toward the cost of compute plus model inference.

When marginal content cost approaches compute cost, two things become possible that were not before: (1) you can run **many** brands in parallel rather than one, and (2) you can sell the machine itself to other creators. That is the arc from Phase 1 to Phase 3.

## The Three Phases

### Phase 1 — Owned & Operated

AMF runs its own faceless media brands. There is no external customer yet. The company is both the operator and the only user of the software.

- **Monetization:** platform ad revenue, sponsorships and brand integrations, affiliate links, and digital products (courses, templates, presets).
- **Goal:** first dollar and proof. Demonstrate that an autonomous brand can be published, grow an audience, and earn real revenue without a human in the daily loop.
- **What we learn:** true unit economics — cost per video, watch-through rates, RPM by niche, the failure modes of autonomous publishing, and which agent behaviors correlate with retention.
- **Why owned-first:** we refuse to sell a factory we have not run ourselves. Every dollar earned here validates the same pipeline we will later license.

Phase 1 success looks like 10 profitable brands, each generating positive AGP/Day, with a documented playbook for spinning up brand number 11 in under a day.

### Phase 2 — Platform / SaaS ("AMF Studio")

The software that ran our brands becomes a product other people can rent. Creators, agencies, and brands log into AMF Studio (the web dashboard, `apps/web`) and point the same agent workforce at their own channels.

- **Monetization:** subscription tiers (Starter $0, Creator $49, Studio $199, Agency $499, Enterprise custom) plus metered render/model credits sold in packs. See [Pricing](./pricing.md).
- **Goal:** convert proven internal tooling into recurring revenue with a target gross margin of 70%+ at the Studio tier.
- **Why it works:** the hard part — a reliable autonomous pipeline — is already built and battle-tested against our own money in Phase 1. Selling it is largely a packaging, onboarding, and support problem rather than a research problem.

Phase 2 shifts the revenue mix from lumpy media income toward predictable MRR, which is what makes the business financeable and eventually valuable.

### Phase 3 — Marketplace & API / Enterprise

The platform opens up. Third parties build and sell agents and templates; developers call AMF capabilities programmatically; enterprises license managed brands.

- **Monetization:** marketplace take rate on agent/template sales, usage-based API/MCP billing (agent-run credits), and enterprise licensing / managed-brand contracts.
- **Goal:** network effects. Every new agent or template makes the platform more useful, which attracts more creators, which attracts more builders.
- **Why it compounds:** AMF stops being the sole author of value. The marketplace turns the ecosystem into a supply of specialized capability that AMF takes a percentage of without building each piece itself.

Phase 3 is where the $100M ARR path and a billion-dollar valuation become defensible, because revenue is diversified across owned media, subscriptions, usage, and take rate simultaneously.

## Business Model Canvas

### Key Partners

- **AI model providers** (frontier and open-weight LLMs, TTS, image, and video generation vendors). Routing across them is a cost and reliability decision managed by the Finance agent (`../../packages/agents/finance/`).
- **Distribution platforms** — YouTube, TikTok, Instagram, plus email service providers and blog/CMS hosts. These are simultaneously partners and dependencies.
- **Affiliate and sponsorship networks** that supply monetization inventory for owned brands.
- **Cloud compute and storage providers** for rendering, media assets, and the event bus.
- **Marketplace builders** (Phase 3) who contribute agents and templates.

### Key Activities

- Running the autonomous production pipeline: research, scripting, media generation, assembly, publishing, and analytics ingestion.
- Model routing and cost control to keep gross margin healthy.
- Growing and pruning the brand portfolio based on AGP/Day.
- Building and hardening AMF Studio for external customers.
- Curating the marketplace and maintaining the public API/MCP surface.

### Key Resources

- **AMF Core** — the orchestrator, agent workforce, and event bus (see [Products](./products.md)).
- The accumulated **playbook and template library**, which encodes what actually works.
- Proprietary performance data: which topics, formats, and agent policies drive watch time and revenue.
- The **brand portfolio** itself as a cash-generating and demonstration asset.
- The Finance agent's model-routing logic, which is the beating heart of margin.

### Value Propositions

- **For AMF (Phase 1):** near-zero marginal cost media production and the ability to run many brands at once.
- **For creators (Phase 2):** a full media team for less than the cost of one freelancer, producing across five channels without burnout.
- **For agencies (Phase 2):** manage many client brands from one dashboard with predictable per-brand economics.
- **For developers and enterprises (Phase 3):** programmatic access to a proven media engine and managed-brand licensing without building it in-house.

See [Target Market](../target-market.md) and [Competitive Advantages](../competitive-advantages.md) for how these land against alternatives.

### Customer Relationships

- Phase 1: none external; AMF is its own customer.
- Phase 2: self-serve onboarding for Starter/Creator, high-touch success for Studio/Agency, dedicated account management for Enterprise.
- Phase 3: developer relations and documentation for API users; revenue-share relationships with marketplace builders.

### Channels

- Owned media brands themselves become a top-of-funnel channel: the content demonstrates the product.
- The Studio web app (`apps/web`) for direct signup and conversion.
- The API and MCP tools for programmatic distribution.
- The marketplace as a discovery surface for both agents and the platform.

### Customer Segments

- Solo faceless-content creators and aspiring media operators.
- Marketing agencies managing multiple client channels.
- Brands running their own always-on content engines.
- Developers integrating media generation into their own products.
- Enterprises wanting fully managed, licensed brands.

### Cost Structure

The dominant costs, roughly in order of magnitude at scale:

- **AI / model inference** — script generation, voice, image, and especially video generation. This is the single largest variable cost and the primary target of the Finance agent's routing.
- **Render / compute** — assembling and encoding media, running the orchestrator and agent workforce.
- **Storage** — media assets, generated content, and the performance-data lake.
- **Distribution** — email sending volume, any paid amplification, and platform API costs.
- **Fixed** — engineering, support, and the small human team overseeing the system.

Target gross margin is 70%+ at the Studio tier, which constrains how much model and render cost each subscription is allowed to consume. When a customer's usage would breach that margin, metered credits absorb the overage — see [Pricing](./pricing.md).

### Revenue Streams

Eight streams, activating across the phases (full detail in [Revenue Model](./revenue-model.md)):

1. Platform ad revenue (YouTube AdSense, TikTok, etc.) — Phase 1.
2. Sponsorships and brand integrations — Phase 1.
3. Affiliate — Phase 1.
4. Digital products (courses, templates, presets) — Phase 1.
5. SaaS subscriptions — Phase 2.
6. Usage-based API / agent-run credits — Phase 2 metering, Phase 3 API.
7. Enterprise licensing / managed brands — Phase 3.
8. Marketplace take rate — Phase 3.

## The Business Flywheel

The engine underneath every phase is the same loop:

**Produce → Publish → Learn → Improve → More Profit → Produce more.**

1. **Produce** — agents generate content at near-compute cost.
2. **Publish** — content ships across all five channels automatically.
3. **Learn** — the analytics ingestion feeds real performance data (watch time, CTR, RPM, conversions) back into the system.
4. **Improve** — the orchestrator and agents adjust topic selection, formats, and pacing based on what earned the most AGP/Day.
5. **More profit** — better decisions raise gross profit per brand.
6. **Reinvest** — profit funds more brands, more model spend where it pays off, and platform development.

Each turn of the loop makes the next turn cheaper and more accurate. The learning is captured in the template and playbook library, so it transfers to new brands and, in Phase 2, to external customers. This is why the model evolves cleanly from owned-media to platform to marketplace: the same flywheel that grows one brand grows a hundred, and the same data that improves our brands improves the product we sell.

## How the Model Evolves

- **Owned-media → Platform:** we prove the pipeline with our own capital, then package the exact tooling as AMF Studio. The risk is retired before customers arrive.
- **Platform → Marketplace:** as customers create their own agents and templates, we let them sell those to each other and take a percentage, plus open the API for usage-based billing.
- **Throughout:** the owned brand portfolio never goes away. It remains both a revenue source and the live proof that the system works, funding development and de-risking each new phase.

## Related Documents

- [Revenue Model](./revenue-model.md) — the eight streams in depth with unit economics and the path to $100M ARR.
- [Pricing](./pricing.md) — tiers, credits, and margin rationale.
- [Products](./products.md) — the six products and how they map to the repo.
- [Target Market](../target-market.md) — who we serve.
- [Competitive Advantages](../competitive-advantages.md) — why AMF wins.
