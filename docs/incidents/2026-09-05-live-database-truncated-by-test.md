# LIVE_DATABASE_TRUNCATED_BY_TEST

Date: 2026-09-05

## Status

The canonical state for `workflow-council-1788567823940` is
`HISTORICAL_LOST_STATE`. It is not resumable and must not be recreated from
memory, summaries, or surviving provenance.

## Affected canonical tables

- `artifacts`
- `workflow_instances`
- `workflow_steps`
- `workflow_checkpoints`
- `capability_executions`
- `execution_evidence`
- `decisions`

## Surviving evidence

- `execution_provenance`
- Post-incident snapshot: `work/incident-post-truncate-20260905.dump`

Surviving provenance is verification evidence only. It cannot reconstruct
deleted canonical artifact payloads.

## Recovery assessment

`CURRENTLY_UNRECOVERABLE`: no local PITR, pre-incident backup, snapshot, or
verified canonical filesystem payload was found. The incident time window is
bounded, but no exact destructive SQL timestamp is asserted.

## Cause and preventive controls

Cause: destructive test database-isolation failure.

Controls now required:

- test fixtures default to `ai_media_factory_test`;
- `TEST_DATABASE_URL == DATABASE_URL` is rejected before destructive SQL;
- destructive E2E cleanup requires an isolated `E2E_DATABASE_URL`;
- destructive-path scanning is part of readiness validation.
