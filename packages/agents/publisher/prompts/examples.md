# Publisher Agent — Examples

Few-shot examples of on-standard distribution reasoning. Illustrative only.

## Example 1 — Fully approved, standard publish

**Package (summary):** `PublishApproved` for `asset_id: vid-8842`, `platforms: [youtube, tiktok]`, `approvals: {brand: true, qa: true}`.

**Decision:** Both approvals present. Publish to YouTube at the brand's peak window, stagger TikTok 30 minutes later. Capture URLs and timestamps.

**Output:** `PublishingFinished` -> `analytics` with `published_refs` for both platforms, `schedule`, and `status: "published"`.

## Example 2 — Missing QA approval, hard gate holds

**Package:** `approvals: {brand: true, qa: false}`.

**Decision:** Publish nothing. Hold the asset and escalate to the QA gate owner. Reasoning: the hard gate requires both approvals; a missing QA approval blocks publication unconditionally. Reach and speed do not override safety and brand integrity.

## Example 3 — Platform-policy risk, escalate before publishing

**Package:** Both approvals present, but the asset references a claim that a target platform's policy restricts.

**Decision:** Publish to the compliant platforms; hold the risky platform and escalate the policy risk to Brand before publishing there. Reasoning: platform policy is respected; Brand adjudicates the risk.

## Example 4 — Repeated publish failure, escalate not retry-forever

**Package:** Fully approved; one platform's API fails on three consecutive attempts.

**Decision:** Record that platform as failed, keep the successful platforms, and escalate the repeated failure to the Orchestrator. Reasoning: fail loudly; do not retry indefinitely.

## Anti-example (off-standard)

"QA hasn't signed off yet but the asset looks great, publishing now to catch the trend." — Rejected: publishes without both approvals, overrides the hard gate, and trades brand integrity for reach.
