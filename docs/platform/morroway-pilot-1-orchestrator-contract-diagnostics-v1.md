# Morroway Pilot 1 Orchestrator Contract Diagnostics V1

Date: 2026-09-25  
Result: `PASS`  
External inference/provider calls: `0`

## Historical execution preserved

Project `morroway`, content `content-mug6d970-jrkufn`, and workflow
`wf-1790293235186-1l4105j4` remain unchanged. Recovery execution
`fd00eb6b-99e1-4d6f-9923-c6d2384d0144` remains failed and was not retried.

The persisted lifecycle proves HTTP 200, valid JSON parsing, 82 bytes of
visible content, and entry into validation. It retained response and visible
content hashes plus provider metadata, but not the visible text or parsed
payload. Repository/log search found no copy. Therefore the exact historical
response and individual missing paths are not recoverable without another
provider request, which this program prohibited.

## Exact reachable failure layer

At the historical revision, the only validation performed after the recorded
`VALIDATING` transition by the routed pre-media Orchestrator was a required-key
presence check. Its only possible failure was
`PRE_MEDIA_CONTRACT_INVALID:orchestrator:<missing keys>`. The thrown message
was discarded by safe diagnostics, so the missing-key list is irrecoverable.

Classification:

- `MODEL_OUTPUT_DEFECT`: the parsed object omitted at least one required field.
- `PROMPT_CONTRACT_MISMATCH`: the production prompt said “matching the required
  contract” but did not enumerate that contract.
- `RUNTIME_INTEGRATION_DEFECT`: `responseSchema` was reduced to generic
  `json_object`, and the failure path did not persist parsed/visible evidence,
  validation paths, usage, or cost automatically.
- No evidence supports a serialization, normalizer, or authority-validator
  defect in the historical call.

## Canonical production contract

Version: `amf-pre-media-orchestrator-v1`.

Required fields are `planId`, `stage`, `objective`, `topic`, `audience`,
`platform`, `researchQuestions`, `researchObjectives`, `desiredDeliverables`,
`tasks`, `status`, and `summary`. `stage` must be
`INITIAL_CONTENT_PLAN`. Declared string/array types are validated. Explicit
authority fields may only remain `NOT_GRANTED` or `OWNER_REQUIRED`, and task
actions cannot grant/execute production, media, publication, upload, or media
generation. Violations hard-fail independently of prose quality.

The production prompt now states the same required fields, types, phase, and
authority boundary. Downstream Research continues to require an
`execution_plan` at `INITIAL_CONTENT_PLAN`; the artifact contract is not
broadened.

The benchmark contract is intentionally scenario/evaluation oriented rather
than an execution-plan artifact schema. It remains separate but aligned on
structured output, tool truth, idempotency, recovery discipline, and Owner
authority. No benchmark contract or evidence was changed.

## Diagnostic persistence remediation

For future OpenRouter HTTP-200 responses, the worker durably records before
agent validation:

- bounded sanitized visible response and SHA-256 fingerprint;
- parsed payload when at most 32 KiB, otherwise fingerprint/truncation state;
- response/contract evidence version;
- provider/model/request metadata and routing context;
- validation stage, deterministic code, paths, expected/actual values,
  contract version, and hard-fail reason;
- usage, calculable cost, latency, execution/workflow lineage, and price
  snapshot through existing provenance/reservation records.

Contract failure still creates no successful artifact. Calculable provider
usage is now reconciled even when post-transport validation fails;
provider-billed cost remains `UNKNOWN` unless separate billing evidence exists.

## Provider-free proof

Fixtures prove valid production payload, missing fields, invalid types/enums,
authority self-grant, unauthorized publication action, valid Owner-boundary
recommendation, HTTP-200 structural failure persistence, cost/usage retention,
restart-readable evidence, and zero artifact persistence for invalid output.
The exact production prompt was captured by the fake transport and contains
the canonical field list. Focused worker/routing suites passed 51/51; API
TypeScript build, served-JavaScript syntax, and Owner-auth tests passed. The
legacy content-api harness reported two failures and then retained an open
handle without diagnostic assertions; it is recorded as unresolved harness
debt rather than silently called green. No provider,
research, media, publication, analytics, or M4 call occurred.
