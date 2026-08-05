# AMF Pricing

This document defines AMF Studio's pricing strategy: the subscription tiers, the credit and metering model, annual versus monthly billing, how price maps to value, discounting policy, and the margin rationale that ties every tier back to the Finance agent's cost control.

Pricing exists to do two things at once: make the product an obvious yes for each customer segment, and protect a target gross margin of 70%+ at the Studio tier. The mechanism that keeps those in balance is metered credits governed by model routing in the [Finance agent](../../packages/agents/finance/). For how these prices roll up into revenue see [Revenue Model](./revenue-model.md); for who each tier is aimed at see [Customer Personas](./customer-personas.md); for why the pricing is defensible see [Competitive Advantages](./competitive-advantages.md).

## Tier Table

All prices are USD per month. Annual billing is ~20% cheaper than monthly (roughly 10 months' price for 12 months of service).

| Tier | Monthly | Annual (per mo, ~20% off) | Included credits/mo | Brands | Channels | Team seats | Support | Best for |
|------|---------|---------------------------|---------------------|--------|----------|-----------|---------|----------|
| Starter | $0 | $0 | Limited (trial-level) | 1 | 1 | 1 | Community | Trying the product |
| Creator | $49 | ~$39 | ~500 | 1 | Up to 3 | 1 | Email | Solo faceless creators |
| Studio | $199 | ~$159 | ~2,500 | Up to 5 | All 5 | 3 | Priority email | Serious operators, small teams |
| Agency | $499 | ~$399 | ~7,500 | Up to 20 | All 5 | 10 | Priority + onboarding | Agencies with many client brands |
| Enterprise | Custom | Custom | Custom / pooled | Unlimited | All 5 | Custom | Dedicated manager + SLA | Managed brands, licensing |

Credit allotments and limits are the primary way tiers are differentiated; higher tiers get more included usage, more brands, more channels, and more seats. Exact allotments are tuned against real cost data but the structure above is the pricing spine.

## Feature and Limit Detail by Tier

**Starter ($0):** A genuine free tier, not a crippled demo. One brand, one channel, and a limited monthly credit allowance sufficient to publish real content and see the pipeline work end to end. No team seats, community support only. Its job is to prove value and convert to Creator, not to be a permanent home.

**Creator ($49):** The solo faceless-content creator. One brand across up to three channels, ~500 included credits (enough for a steady daily-or-near-daily cadence in most niches), email support. Priced deliberately below the cost of a single freelance editor so the decision is easy.

**Studio ($199):** The margin anchor and the tier the whole cost model is designed around. Up to five brands, all five channels, three team seats, ~2,500 included credits, priority support. This is the serious operator or small team running a real portfolio. Target gross margin 70%+ is defined and enforced at this tier.

**Agency ($499):** Multi-client management. Up to 20 brands, all channels, ten seats, ~7,500 included credits, plus onboarding help. The per-brand cost drops sharply versus Creator, which is exactly right for an agency running many client brands from one dashboard.

**Enterprise (custom):** Unlimited brands, custom pooled credits, dedicated account management, an SLA, and options for enterprise licensing and fully managed brands. Priced per engagement because scope varies widely; this is where Phase 3 licensing revenue lives.

## The Credit and Metering Model

**What a credit is:** render/model credits are the metered unit. **1 credit ≈ one standard AI action** — a script generation, a voice render, an image, or a video segment. Credits are sold in packs and are also included in each subscription tier as a monthly allotment.

**How metering works:** each subscription includes a credit allowance. Usage inside the allowance is covered by the flat subscription price. Usage above the allowance draws down purchased credit packs (or auto-tops-up, per account settings). This is the pressure valve that lets a flat subscription coexist with genuinely variable AI costs.

**Why credits exist:** a customer generating 30-second shorts occasionally and a customer rendering long-form video daily have wildly different cost profiles. A single flat price would either overcharge the light user or destroy margin on the heavy user. Credits align what a customer pays with what they actually consume, which is what keeps the 70%+ target intact as usage grows. See [Revenue Model](./revenue-model.md) for the credit unit economics (~$0.10 sell against ~$0.03 cost).

## Annual vs Monthly

Monthly billing is the default and lets customers try a tier with low commitment. Annual billing is offered at ~20% off (pay for roughly ten months, get twelve). The discount is deliberate: annual plans improve cash flow, reduce churn, and lower payment-processing overhead, and those savings are shared back to the customer as the discount rather than pocketed. Credits included with an annual plan are granted monthly rather than dumped up front, to keep usage — and therefore cost — smooth.

## Positioning vs Value

Pricing is anchored to the value of a replaced media team, not to a per-feature checklist:

- **Creator at $49** replaces work that would cost hundreds per month in freelance editing and scripting for a single brand. The value-to-price ratio is intentionally lopsided to drive adoption.
- **Studio at $199** runs up to five brands across all five channels — work that would occupy a small human team full-time. Even one modestly monetized brand covers the subscription many times over (recall from [Revenue Model](./revenue-model.md) that a single long-form brand can generate hundreds of dollars per day).
- **Agency at $499** manages up to 20 client brands; the per-brand cost is a rounding error against what an agency bills its clients.

The message is consistent: AMF is priced as a fraction of the labor it replaces, and the customer keeps the difference. This is grounded in the [Competitive Advantages](./competitive-advantages.md) of running content at near-compute marginal cost.

## Discounting Policy

- **Standard discount:** the ~20% annual discount, available to everyone. No negotiation required.
- **No ad-hoc self-serve discounts** on Creator and Studio; consistent pricing keeps the model clean and fair.
- **Agency and Enterprise** may negotiate on volume (brand count, seats, pooled credits) and term length. Any concession is tied to commitment — a bigger discount requires a longer term or higher volume, never a giveaway.
- **Nonprofit/education and design-partner** discounts may be offered selectively and time-boxed, chosen for strategic value (case studies, feedback, reference accounts) rather than to close a single deal.
- **Credits are never discounted below the margin floor.** Because credits map directly to variable cost, discounting them would breach the 70%+ target; volume credit packs may carry a small per-credit reduction only while the underlying model cost supports it.

## Margin Rationale (tied to the Finance Agent)

The 70%+ target gross margin at the Studio tier is not an aspiration bolted on after the fact — it is enforced in the system by the [Finance agent](../../packages/agents/finance/). The Finance agent controls model routing: for each AI action it chooses among model providers to deliver acceptable quality at the lowest defensible cost, and it watches the ratio of cost to price in real time.

Concretely, a $199 Studio subscription is allowed at most roughly $60/month of combined model and render cost before metered credits must absorb the overage. If a customer's included-credit usage would push cost past that line, the metering model routes further usage onto paid credits, which themselves carry the same ~70% margin. This is how a flat subscription price and uncapped AI ambition coexist without eroding profitability.

Because the same routing and metering logic runs AMF's own [Brand Portfolio](./products.md), the margin discipline is proven on AMF's own money before it is ever applied to a customer's bill. Pricing, in other words, is downstream of a cost-control system that has already been tested in production — which is what makes the 70%+ target credible rather than hopeful.

## Related Documents

- [Revenue Model](./revenue-model.md) — how these prices aggregate into MRR, ARR, and the $100M path.
- [Customer Personas](./customer-personas.md) — who each tier is designed for.
- [Competitive Advantages](./competitive-advantages.md) — why AMF can price this aggressively and still profit.
- [Products](./products.md) — the product surfaces these tiers unlock.
