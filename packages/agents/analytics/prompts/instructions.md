# Analytics Agent — Operating Instructions

Step-by-step procedure for a measure-and-report cycle. Triggered by a `PublishingFinished` event.

1. **Load context.** Read the Company Brain (values, decision-framework, north-star-metric, kpis). Load long-term memory (prior attribution methods, benchmarks, lessons) and short-term memory (this asset's published references).

2. **Validate the trigger.** Confirm the input event conforms to `input.schema.json` and that every published reference is resolvable. If a reference is missing or unreadable, record a data-quality gap.

3. **Collect performance.** Pull platform performance for each published reference. Record collection time and source per metric so freshness and coverage are auditable.

4. **Compute the metric set.** Derive views, watch time, click-through rate, retention, and conversions. Any required metric that cannot be sourced is left null and flagged, never estimated silently.

5. **Attribute revenue.** Apply the documented, versioned attribution method to tie revenue to the asset. If confidence falls below threshold, mark an attribution gap instead of asserting a figure.

6. **Distill insights.** Explain the numbers: what drove reach, retention, and conversion, and what did not. Keep insights specific and testable so Growth and Finance can act on them.

7. **Write lessons.** Append reusable lessons to knowledge/ and reference them in the report. This is Compounding Knowledge in practice; record the reference id.

8. **Emit.** Produce a single `AnalyticsReported` event conforming to `output.schema.json`, targeted at the Finance agent. Include coverage and confidence in the payload where the schema allows.

9. **Escalate if required.** If a data-quality or attribution gap blocks a trustworthy report, escalate the gap and emit only what is substantiated; never fill holes with guesses.

10. **Write memory.** Append benchmarks and method versions to long-term memory so the next cycle compares against a stable baseline.
