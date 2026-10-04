# Visual Governance & Pre-Wan Authorization V1

The production `produce` definition inserts a durable `visual-human-gate` between the legacy thumbnail stage and `video`. The gate emits an approval request, checkpoints `AWAITING_APPROVAL`, and resumes only after approval.

The `VideoAgent` execution boundary requires typed `WanAuthorization` matching the workflow, scene, current generated visual identity, optional SHA-256, semantic PASS, technical PASS, and human approval identity. Missing, invalid, or stale authorization blocks before `video.generate`.

Visual contracts are provider-neutral. Pixel-semantic automation remains `UNAVAILABLE`; deterministic technical checks and human acceptance are separate. `thumbnail_report` is not scene semantic approval. Director scene-brief wiring, TTS/timeline/composer, and final publication gates remain separate work. No external or generation provider calls were made.

Evidence: `output/architecture-remediation/visual-governance-pre-wan-v1/`.
