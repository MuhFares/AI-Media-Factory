# Multi-Project / Multi-Channel V1 — Proof (Program 5)

**Date:** 2026-09-23. **Mode:** PLATFORM_VALIDATION_MODE.
Authority: NOT_GRANTED / NOT_GRANTED / NOT_PUBLISHED (unchanged).
M4 publication intact: AfbPyQ-UFwM (private) on channel UCA5ECzcK_96akfUT5fQUT3A.

## Platform hierarchy

AMF platform → projects (media businesses) → channels/destinations →
strategy, content, workflows, artifacts, publications, analytics, learning,
costs, decisions. Every scoped read is server-enforced by projectId;
portfolio surfaces aggregate intentionally.

## Channels

Additive tables: `channels` (project_id, platform, external id, handle,
display name, status PENDING→VERIFIED, capabilities, verification note)
and `credential_bindings` (opaque reference labels only; raw secrets never
enter the DB). Verified via Owner attestation (no provider call). Platform
taxonomy: youtube implemented; tiktok/instagram/facebook/x/other reserved
as unsupported (fail closed, never fake adapters).

## Publishing routing

Dry-run check `GET /control/publishing/route` proves project/channel/
binding/visibility agreement without executing. Every mismatch is a 409
fail-closed (unverified channel, wrong project, revoked binding,
unsupported visibility). No provider contacted; no M4 measurement consumed.

## Project model

`control_projects` extended with metadata + updated_at; registration
validates id (alphanumeric/dash, max 200) and name; Morroway remains
pinned ACTIVE. Creation is a workspace only: no strategy/content/workflows
cloned. Lifecycle statuses DRAFT/ACTIVE/PAUSED/ARCHIVED (archival only).

## Isolation guarantees (matrix A-L proven)

A content, subjects, strategy isolated (7-test matrix).
B artifacts scoped via project + workflow-ownership check (403 on mismatch).
C analytics, learning project-scoped; observations now carry channel_id.
D channels owned per project; cross-project use blocked.
E credentials bound per project/channel; opaque refs.
F publication route fail-closed on every mismatch before provider.
G analytics channel-attributable; cross-project aggregation only in
portfolio/system views.
H learning chain scoped (already project-scoped, verified).
I authority scoped (already per-project approvals).

## Dashboard / hub changes

Hub shows per-project content/channel/decision counts and creation journey.
Dashboard shows project channels (creation, verification, binding, dry-run
route) and a project switcher (location.search ?project=) plus chip.
Decision cards show project context. No second approval system.

## Live verification (supervised runtime)

`node scripts/amf-supervise.mjs` running with API + persistent production
worker (Morroway heartbeat fresh) + UI. Health live, queue idle, served
bundle hash matches source, lifecycle still NOT_PUBLISHED with private
provider record visible.

## Tests

Isolation matrix 7/7 (with strategy proposal cross-project proof), plus all
Program 2–4 regressions green (database 73/73, API 79/79, tool-framework
22/22, provider-adapters 61/61, pytest 16/16). No provider/LLM calls in
Program 5 (mocked channel verification only).

## Known remaining work outside Program 5

No destructive deletion of projects (archival only). No channel deletion
path; no per-channel cost rollup yet. Social platform adapters not built.
L3/L4 automation intentionally absent.
