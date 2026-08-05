# QA Agent — Tests

Eval-style tests for the QA agent. These are placeholders for now; no logic is implemented yet.

Planned test categories:

- **Prompt regression** — detect behavioral drift in the gate verdict when prompts or models change.
- **Schema validation** — every emitted `QAReviewed` event conforms to `../schemas/output.schema.json`; malformed inputs are correctly held.
- **Behavioral evals** — the gate holds assets with injected defects (corrupt render, out-of-bounds duration, missing captions) and passes clean assets, with a low false-hold rate.

See [evaluation.md](./evaluation.md) for methodology and thresholds and [scenarios.md](./scenarios.md) for concrete cases.
