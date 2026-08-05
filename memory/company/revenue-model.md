# AMF Revenue Model

This document breaks down all eight revenue streams that power AI Media Factory: how each works, which phase it activates, illustrative unit economics, and how the revenue mix shifts over time. It closes with an illustrative path to $100M ARR.

Every figure here is an **illustrative target for planning, not a guarantee**. Real numbers depend on niche, platform payout changes, model costs, and execution. All streams are ultimately judged by their contribution to [Autonomous Gross Profit per Day](./north-star-metric.md), and pricing detail lives in [Pricing](./pricing.md). Health of the model is tracked via [KPIs](./kpis.md).

## The Eight Streams at a Glance

| # | Stream | Activates | Type | Primary phase driver |
|---|--------|-----------|------|----------------------|
| 1 | Platform ad revenue | Phase 1 | Media | Owned brands |
| 2 | Sponsorships / brand integrations | Phase 1 | Media | Owned brands |
| 3 | Affiliate | Phase 1 | Media | Owned brands |
| 4 | Digital products | Phase 1 | Media | Owned brands |
| 5 | SaaS subscriptions | Phase 2 | Recurring | AMF Studio |
| 6 | Usage-based API / agent-run credits | Phase 2 metering, Phase 3 API | Usage | Metering + API |
| 7 | Enterprise licensing / managed brands | Phase 3 | Contract | Enterprise |
| 8 | Marketplace take rate | Phase 3 | Take rate | Marketplace |

## Stream 1 — Platform Ad Revenue

**How it works:** Owned brands earn a share of advertising revenue from YouTube (AdSense), TikTok, and similar platforms based on views and engagement. This is the first and most direct monetization for a faceless brand.

**Unit economics (illustrative):**
- YouTube long-form RPM ranges widely by niche: roughly $2–$8 per 1,000 monetized views for general content, and $10–$25+ in high-value niches like finance, business, and technology.
- Short-form (Shorts, TikTok) pays far less — often $0.02–$0.10 per 1,000 views — so shorts are treated as a discovery and audience-building channel that feeds higher-RPM long-form and other streams, not a primary earner.
- A single long-form brand posting daily and averaging 50,000 monetized views per video in a $6 RPM niche generates roughly 50 × $6 = $300/day gross from ads alone, before other streams.

**Cost note:** ad revenue is high-margin because production is already paid for at near-compute cost; the RPM flows almost directly into AGP/Day.

## Stream 2 — Sponsorships and Brand Integrations

**How it works:** Once a brand has audience, sponsors pay for integrated segments or dedicated placements. Deals are negotiated per-brand and scale with audience size and niche relevance.

**Unit economics (illustrative):**
- Sponsorship pricing commonly runs $15–$30 per 1,000 views for an integrated segment (a $20 CPM on 50,000 views is roughly $1,000 per integration).
- A brand running four sponsored integrations per month at that level adds ~$4,000/month.
- High-intent niches command premium CPMs; low-intent entertainment niches sit at the bottom of the range.

**Why it matters:** sponsorships often exceed ad revenue for mid-sized brands and carry near-zero incremental cost, so they are a major AGP/Day lever in Phase 1.

## Stream 3 — Affiliate

**How it works:** Content includes affiliate links to relevant products; the brand earns a commission on resulting sales. Best suited to review, tutorial, and recommendation formats.

**Unit economics (illustrative):**
- Commission rates vary by category: physical goods often 3–10%, software and digital products 20–40%, and some recurring SaaS affiliate programs pay 20–30% of subscription revenue for the customer's lifetime.
- A tech brand driving 200 qualified clicks/day at a 3% conversion and a $40 average commission yields 200 × 0.03 × $40 = $240/day.

**Why it matters:** affiliate income compounds with audience trust and back-catalog; older videos keep earning, making it a durable tail on AGP/Day.

## Stream 4 — Digital Products

**How it works:** Brands and AMF itself sell courses, templates, and presets — for example a course on a niche skill the brand teaches, or the very templates AMF uses internally.

**Unit economics (illustrative):**
- A $49 template pack or a $199 course, sold 100–500 times per month across a growing portfolio, adds $5,000–$100,000/month depending on scale and price point.
- Margins are extremely high after creation because delivery is digital; the main cost is one-time production and payment processing (~3%).

**Strategic role:** digital products also seed Phase 2 demand — customers who buy AMF's templates are natural AMF Studio subscribers, and the [Template & Playbook Library](./products.md) is the same asset sold and used internally.

## Stream 5 — SaaS Subscriptions

**How it works:** In Phase 2, external customers subscribe to AMF Studio. Tiers: Starter $0 (limited monthly credits), Creator $49, Studio $199, Agency $499, Enterprise custom. Annual billing is ~20% cheaper. Full detail in [Pricing](./pricing.md).

**Unit economics (illustrative MRR math):**
- 1,000 Creator subscribers at $49 = $49,000 MRR = $588,000 ARR.
- 300 Studio subscribers at $199 = $59,700 MRR = $716,400 ARR.
- 100 Agency subscribers at $499 = $49,900 MRR = $598,800 ARR.
- Blended, that mix is ~$158,600 MRR / ~$1.9M ARR from ~1,400 customers, an ARPA (average revenue per account) of roughly $113/month.
- Target gross margin 70%+ at the Studio tier means each $199 subscription is allowed at most ~$60/month of model+render cost before metered credits kick in.

**Why it matters:** subscriptions convert lumpy media income into predictable recurring revenue, which is what makes the business financeable and drives valuation.

## Stream 6 — Usage-Based API / Agent-Run Credits

**How it works:** Metered render/model credits are sold in packs; 1 credit ≈ one standard AI action (a script generation, a voice render, an image, a video segment). Credits absorb usage above a tier's included allotment (Phase 2 metering) and, in Phase 3, become the billing unit for the public API and MCP tools.

**Unit economics (illustrative):**
- If a credit sells for ~$0.10 and the underlying model+render cost is ~$0.03, the gross margin on metered usage is ~70%, matching the platform target.
- A power customer consuming 20,000 credits/month beyond their plan adds $2,000/month at ~$1,400 gross profit.
- API/MCP developers in Phase 3 pay the same credit economics programmatically, turning AMF capabilities into a usage-billed backend.

**Why it matters:** usage billing aligns revenue with cost automatically. Heavy users pay proportionally, which protects margin and scales revenue with adoption without renegotiation.

## Stream 7 — Enterprise Licensing / Managed Brands

**How it works:** In Phase 3, enterprises license the platform or contract AMF to run fully managed brands on their behalf — an always-on content engine as a service.

**Unit economics (illustrative):**
- Enterprise licensing and managed-brand contracts are custom, commonly $2,000–$20,000+/month depending on brand count, channels, and service level.
- 20 enterprise accounts averaging $8,000/month = $160,000 MRR = $1.92M ARR from a small number of high-value relationships.

**Why it matters:** enterprise revenue is large, sticky, and diversifies the base away from many-small-accounts churn risk.

## Stream 8 — Marketplace Take Rate

**How it works:** In Phase 3, third parties sell agents and templates in the marketplace; AMF takes a percentage of each transaction. See [Products](./products.md).

**Unit economics (illustrative):**
- At a 20–30% take rate, $1,000,000 in annual gross marketplace volume returns $200,000–$300,000 to AMF at near-zero incremental cost.
- Marketplace revenue scales with ecosystem size rather than AMF's own headcount, so it is highly leveraged.

**Why it matters:** the take rate is the network-effect engine — more builders create more inventory, attracting more customers, attracting more builders.

## Phased Revenue Mix Over Time

Illustrative mix, showing how the center of gravity moves from media to recurring to diversified:

| Stream group | Phase 1 | Phase 2 | Phase 3 |
|--------------|---------|---------|---------|
| Media (ads, sponsor, affiliate, digital products) | ~100% | ~40% | ~25% |
| SaaS subscriptions | 0% | ~50% | ~35% |
| Usage credits / API | 0% | ~10% | ~15% |
| Enterprise licensing | 0% | ~0% | ~15% |
| Marketplace take rate | 0% | ~0% | ~10% |

Phase 1 is entirely media revenue from owned brands. Phase 2 is subscription-led with media as a stable base and metering on top. Phase 3 diversifies across all eight streams, which is what makes the revenue base resilient.

## Illustrative Path to $100M ARR

Two complementary engines get to nine figures. These are planning targets, not promises.

**Engine A — Owned brand portfolio:**
- Long-term goal: 100+ autonomous brands.
- If 100 brands each average $250,000/year in blended media revenue (ads + sponsorships + affiliate + digital products), that is $25M ARR from owned media.
- This is the Phase 1 flywheel scaled: the same playbook applied 100 times.

**Engine B — Platform, usage, enterprise, and marketplace:**
- SaaS: 30,000 blended subscribers at an ARPA of ~$150/month ≈ $54M ARR. For example, a mix weighted toward Creator ($49) and Studio ($199) with a meaningful Agency ($499) tail reaches this ARPA.
- Usage credits / API: ~$8M ARR from metered overage and Phase 3 API consumption.
- Enterprise licensing: ~$8M ARR from ~80 managed-brand and licensing accounts averaging ~$100,000/year.
- Marketplace take rate: ~$5M ARR at a 20–30% take on ~$20M annual marketplace volume.

**Combined illustrative total:**

| Source | Illustrative ARR |
|--------|------------------|
| Owned brand portfolio (100 brands) | $25M |
| SaaS subscriptions (~30k accounts) | $54M |
| Usage credits / API | $8M |
| Enterprise licensing / managed brands | $8M |
| Marketplace take rate | $5M |
| **Total** | **$100M** |

The point is not the exact split — it is that no single stream has to carry the whole company. Five diversified engines, each grounded in the same proven pipeline, sum to the $100M ARR path and the billion-dollar valuation target. Progress toward it is measured every day in AGP/Day and the broader [KPIs](./kpis.md).

## Related Documents

- [Pricing](./pricing.md) — tier structure and credit economics referenced throughout.
- [KPIs](./kpis.md) — how revenue health is measured.
- [North Star Metric](./north-star-metric.md) — AGP/Day, the number every stream feeds.
- [Business Model](./business-model.md) — the phases and flywheel behind these streams.
