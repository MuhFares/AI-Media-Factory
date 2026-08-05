# Brand Agent — Workflow

How the Brand agent executes within the event-driven pipeline. Brand is the second of two gates and the final checkpoint before publishing.

## Position in the pipeline

```
... -> Video(VideoFinished) -> QA(QAReviewed) -> Brand(PublishApproved) -> Publisher -> ...
```

QA certifies technical fitness; Brand certifies voice, safety, and compliance. Only an asset carrying both approvals reaches the Publisher.

## Trigger

- The Orchestrator routes a `QAReviewed` event to Brand once the QA gate completes.

## Execution steps

1. Brand receives `QAReviewed` and validates it against [schemas/input.schema.json](../schemas/input.schema.json).
2. If `passed` is false, Brand does not proceed; the asset returns to rework via the Orchestrator.
3. Brand runs the review procedure in [prompts/instructions.md](../prompts/instructions.md): brand-safety, citations, voice conformance, packaging honesty.
4. Brand decides:
   - All checks pass -> emit one `PublishApproved` event (validated against [schemas/output.schema.json](../schemas/output.schema.json)) with `approvals {brand: true, qa: true}`, targeted at the Publisher.
   - Safety/compliance failure -> HOLD; escalate to CEO / human operator (one-way door).
   - Off-voice / unsupported-claim -> HOLD; return to the producing agent (Writer, SEO, or Thumbnail) for rework.
   - Ambiguous -> HOLD; escalate.
5. Brand writes the ruling to long-term memory.

## Failure handling

- **Hard safety HOLD:** never auto-resolved; always escalated. Publication cannot proceed on this asset until a human operator rules.
- **Rework HOLD:** routed back to the producing agent; re-enters the pipeline after correction.
- Retries, dead-lettering, and the rework loop are coordinated by the Orchestrator and event bus.

## Guarantees

- Brand never emits `PublishApproved` when a brand-safety check fails — regardless of the asset's expected performance. The safety line is absolute and cannot be traded for reach, speed, or profit.
- The Publisher enforces the reciprocal guarantee: it will not publish an asset that does not carry both approvals.
