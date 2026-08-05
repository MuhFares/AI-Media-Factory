# AMF Products

AI Media Factory ships as six interlocking products. Together they are the AI Operating System that runs an autonomous media company: the engine (AMF Core), the proof and cash engine (Brand Portfolio), the product other people rent (AMF Studio), and three surfaces that open the platform up (Marketplace, Template Library, API & MCP Tools).

This document describes each product: what it is, who it serves, which phase it belongs to, how it maps onto the repository (`apps/` and `packages/`), how it is monetized, and its roadmap stage. For the strategy behind the phases see [Business Model](./business-model.md); for tiers and credits see [Pricing](./pricing.md); for sequencing see [Roadmap](../roadmap.md).

## Repository Map (orientation)

- `packages/agents/` — the specialized AI agent workforce, including `packages/agents/finance/` (model routing and cost control).
- `packages/` (core) — orchestrator and event bus that coordinate agents.
- `apps/web` — the AMF Studio dashboard.
- Marketplace, template library, and API/MCP surfaces build on the same core packages and agent contracts.

## 1. AMF Core (AI-OS)

**Description:** The operating system underneath everything — the orchestrator, the agent workforce, and the event bus. The orchestrator decomposes a goal ("grow this brand's AGP/Day") into tasks, dispatches them to specialized agents (research, script, voice, image, video assembly, publishing, analytics, finance), and coordinates their work over the event bus. Agents communicate through events rather than direct calls, which lets the workforce scale horizontally and lets new agent types be added without rewiring the system.

**Who it serves:** Internally, AMF itself (every brand runs on Core). Externally, it is the substrate that all other products are built on — customers never buy Core directly, they buy the experiences it powers.

**Phase:** Phase 1 (built first; it is what runs the owned brands).

**Repo mapping:** the core orchestrator and event bus packages plus `packages/agents/*`. The [Finance agent](../../packages/agents/finance/) lives here and governs model routing to protect the 70%+ target gross margin described in [Pricing](./pricing.md).

**Monetization:** indirect. Core has no price of its own; it is monetized through the brands it runs (Phase 1), the subscriptions it powers (Phase 2), and the API usage it serves (Phase 3).

**Roadmap stage:** Foundational and continuously hardened. This is the first thing built and the last thing that stops improving.

## 2. AMF Brand Portfolio

**Description:** The collection of owned, faceless media brands that AMF operates across YouTube, TikTok, Instagram, blog, and email. Each brand is an autonomous business unit running on AMF Core, monetized through media revenue streams.

**Who it serves:** AMF and its audiences. The brands are simultaneously a revenue source, a live demonstration of the platform, and a top-of-funnel channel for AMF Studio.

**Phase:** Phase 1 (this is where the first dollar comes from and where the pipeline is proven).

**Repo mapping:** built entirely on AMF Core; each brand is configuration plus agent policies rather than new code. Spinning up a brand should approach a one-day operation using the [Template & Playbook Library](#5-template--playbook-library).

**Monetization:** the four media streams — platform ad revenue, sponsorships/brand integrations, affiliate, and digital products. See [Revenue Model](./revenue-model.md) for unit economics.

**Roadmap stage:** Active and scaling. Near-term goal is 10 profitable brands; long-term goal is 100+ autonomous brands on the $100M ARR path.

## 3. AMF Studio (SaaS Dashboard)

**Description:** The web application (`apps/web`) that lets external customers point the AMF agent workforce at their own channels. It exposes brand setup, content pipelines, scheduling, analytics, and credit usage in a dashboard — the same capabilities that run AMF's own brands, packaged for self-serve use.

**Who it serves:** Solo creators, agencies managing multiple client brands, and brands running their own content engines. See [Target Market](../target-market.md).

**Phase:** Phase 2 (the platform turn — proven internal tooling becomes a product).

**Repo mapping:** `apps/web` on top of AMF Core. Customer brands run through the same orchestrator, event bus, and agents as owned brands, with per-account isolation and credit metering layered on.

**Monetization:** subscription tiers — Starter $0, Creator $49, Studio $199, Agency $499, Enterprise custom — plus metered credits for usage above plan. Full detail in [Pricing](./pricing.md).

**Roadmap stage:** Mid-term flagship launch. This is the product that converts the company from lumpy media income to predictable MRR.

## 4. Agent Marketplace

**Description:** A marketplace where third parties build, publish, and sell specialized agents (and where AMF publishes first-party ones). A creator who builds a better thumbnail agent or a niche-specific research agent can list it; other customers install it into their own workforce.

**Who it serves:** Builders and developers on the supply side; all Studio customers on the demand side.

**Phase:** Phase 3 (opening the platform to network effects).

**Repo mapping:** built on the `packages/agents/` contracts — agents conform to a standard interface so third-party agents plug into the same orchestrator and event bus as first-party ones.

**Monetization:** marketplace take rate (a 20–30% cut of each transaction). See [Revenue Model](./revenue-model.md).

**Roadmap stage:** Long-term. Depends on a healthy Studio customer base and a stable agent interface, both of which come first.

## 5. Template & Playbook Library

**Description:** A curated library of content templates, format presets, and operating playbooks that encode what actually works — the accumulated learning from running the owned brand portfolio. Templates let a new brand or a new customer skip cold-start experimentation and launch with proven formats.

**Who it serves:** Internally, it is what makes spinning up brand number 11 fast. Externally, it is both a paid digital product and a value driver inside Studio subscriptions.

**Phase:** Phase 1 as an internal asset and digital product; deepened in Phase 2 as a customer-facing library; extended in Phase 3 as marketplace inventory.

**Repo mapping:** consumed by AMF Core as brand configuration and agent policy; surfaced in `apps/web` for customers to browse and apply.

**Monetization:** sold directly as digital products (Phase 1 media stream), bundled into Studio tiers as a subscription value driver (Phase 2), and sold by third parties via the marketplace take rate (Phase 3).

**Roadmap stage:** Continuously growing. Every turn of the produce→publish→learn→improve flywheel adds to it.

## 6. AMF API & MCP Tools

**Description:** Programmatic access to AMF capabilities. Developers call the API — and MCP (Model Context Protocol) tools — to invoke agents, run content pipelines, and integrate media generation into their own products. This exposes the same engine that powers Studio, minus the dashboard.

**Who it serves:** Developers and enterprises embedding autonomous media generation into their own systems.

**Phase:** Phase 3 (though metering infrastructure is built in Phase 2 for Studio credits).

**Repo mapping:** thin API/MCP layer over AMF Core packages, reusing the same agent contracts and credit metering as Studio.

**Monetization:** usage-based agent-run credits (1 credit ≈ one standard AI action), billed programmatically at the same ~70% margin as platform metering. Enterprise consumers may negotiate licensing on top. See [Pricing](./pricing.md).

**Roadmap stage:** Long-term, built on the metering foundation laid in Phase 2.

## How the Products Fit Together

AMF Core is the engine. The Brand Portfolio proves it and pays for it. AMF Studio rents it out. The Marketplace, Template Library, and API/MCP Tools open it up so that value can come from an ecosystem rather than from AMF alone. Each product reuses the same core packages and agent contracts, which is why the company can move from owned-media to platform to marketplace without rebuilding — it is one system, exposed through progressively wider doors.

## Related Documents

- [Business Model](./business-model.md) — the three phases and flywheel these products implement.
- [Pricing](./pricing.md) — how Studio, credits, and licensing are priced.
- [Roadmap](../roadmap.md) — the sequence in which these products ship.
- [Revenue Model](./revenue-model.md) — how each product earns.
