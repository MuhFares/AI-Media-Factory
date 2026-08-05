# Brand Agent — Tests

Eval-style tests for the Brand agent. These are placeholders for now; no logic is implemented yet.

Planned test categories:

- **Prompt regression** — detect drift in the approve/hold verdict when prompts or models change.
- **Schema validation** — every emitted `PublishApproved` event conforms to `../schemas/output.schema.json`; the `approvals` and `brand_safety.safe` fields are always true when emitted.
- **Behavioral evals** — the gate holds unsafe, off-voice, and unsupported-claim assets and approves clean ones, with brand-safety incidents held at zero.

See [evaluation.md](./evaluation.md) for methodology and thresholds and [scenarios.md](./scenarios.md) for concrete cases.
