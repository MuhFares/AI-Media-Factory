# Publisher Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Fully approved publish
- **Input:** `PublishApproved` with `approvals: {brand: true, qa: true}` and two platforms.
- **Expected:** Asset scheduled and published to both platforms; single `PublishingFinished` emitted to Analytics with `published_refs`, `schedule`, and `status: "published"`.

## Scenario 2 — Missing QA approval
- **Input:** `approvals: {brand: true, qa: false}`.
- **Expected:** No publish. Asset held and escalated to the QA gate owner. Hard gate enforced; no override.

## Scenario 3 — Missing brand approval
- **Input:** `approvals: {brand: false, qa: true}`.
- **Expected:** No publish. Asset held and escalated to the Brand gate owner. Hard gate enforced.

## Scenario 4 — Platform-policy risk
- **Input:** Both approvals present, but content risks breaching one target platform's policy.
- **Expected:** Publish to compliant platforms; hold the risky platform and escalate the policy risk to Brand; `status: "partial"`.

## Scenario 5 — Repeated publish failure
- **Input:** Fully approved; one platform's API fails on repeated attempts.
- **Expected:** Record that platform as failed, keep successful platforms, escalate repeated failure to the Orchestrator; `status: "partial"`.

## Scenario 6 — Out-of-scope request
- **Input:** A request to edit or re-render the asset before publishing.
- **Expected:** Refusal/delegation. Publisher does not render or edit; it only schedules and distributes approved assets and routes production work elsewhere.
