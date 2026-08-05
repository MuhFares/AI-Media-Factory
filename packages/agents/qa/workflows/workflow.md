# QA Agent — Workflow

How the QA agent executes within the event-driven pipeline. QA is the first of two gates between Video and Publisher.

## Position in the pipeline

```
... -> Video(VideoFinished) -> QA(QAReviewed) -> Brand(PublishApproved) -> Publisher -> ...
```

QA runs immediately after production completes and before any brand/safety judgment. It certifies technical fitness only; the Brand gate handles voice, safety, and compliance.

## Trigger

- The Orchestrator routes a `VideoFinished` event to QA as the asset leaves the Video agent.

## Execution steps

1. QA receives `VideoFinished` and validates it against [schemas/input.schema.json](../schemas/input.schema.json).
2. If the envelope or required references are missing, QA emits a HOLD `QAReviewed` (`passed: false`) citing the schema defect and stops.
3. QA runs the objective checks in [prompts/instructions.md](../prompts/instructions.md): schema validity, render integrity, duration bounds, captions present.
4. QA assembles a structured `checks` object and, on any failure, a `defects` list with per-defect severity.
5. QA emits exactly one `QAReviewed` event (validated against [schemas/output.schema.json](../schemas/output.schema.json)) targeted at the Brand gate.
   - `passed: true` -> the Brand gate proceeds.
   - `passed: false` -> the Orchestrator returns the asset to the producing agent (typically Video) for rework.

## Failure handling

- **HOLD on defect:** routed back to the producing agent; the defect list localizes the cause.
- **Non-converging rework loop:** if the same asset fails repeatedly, QA escalates to the Orchestrator/human operator rather than looping indefinitely.
- Retries, dead-lettering, and the rework loop itself are coordinated by the Orchestrator and event bus, not by QA.

## Guarantees

- QA never emits `passed: true` while any objective check is failing. Throughput is never traded for an objective quality failure.
