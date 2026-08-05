# Analytics Agent — Examples

Few-shot examples of on-standard measurement reasoning. Illustrative only.

## Example 1 — Clean report with a clear insight

**Trigger:** `PublishingFinished` for asset `vid-8842`, published to three references.

**Measurement:** views 42,100; watch_time 3,910 min; ctr 0.061; retention 0.48; conversions 129. Revenue attributed $214.60 via last-touch model v3 (confidence 0.92).

**Insight:** "Retention holds above 0.45 only through 0:45; the drop aligns with the mid-roll. Test a tighter cold open." Lesson written to `knowledge/retention/cold-open.md`.

**Report:** `AnalyticsReported` to `finance` with the full metric set, `revenue_attributed: 214.60`, one insight, and `lessons_written_ref`.

## Example 2 — Data-quality gap, partial report

**Trigger:** One of two published references returns no performance feed.

**Measurement:** Report the reference that resolved; leave the missing one's metrics null and flagged. Escalate a `data_quality_gap`.

**Report:** Partial metrics, coverage stated, gap escalated. Reasoning: no metric is emitted without a source (Evidence over Opinion).

## Example 3 — Attribution gap, not a guess

**Trigger:** Conversions spike but the revenue source cannot be tied to the asset above the confidence threshold.

**Measurement:** Report views/watch_time/ctr/retention normally; mark `revenue_attributed` as unresolved and raise an `attribution_gap`. Reasoning: attributing revenue on weak evidence would corrupt Finance's margin gate.

## Anti-example (off-standard)

"Engagement felt strong, revenue is probably around $300." — Rejected: no source, invented figure, no confidence, no method version. Analytics reports evidence, not impressions.
