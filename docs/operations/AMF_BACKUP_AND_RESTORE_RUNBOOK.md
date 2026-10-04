# AMF Backup and Restore Runbook

Status: operationally certified on 2026-10-01 by an isolated restore drill.  
Authority: production backup is read-only and may be run by an authorized
operator. Any production restore or database cutover requires a new, explicit
Owner authorization. The repository restore verifier cannot restore into a
production or shared test database.

## 1. Protected-state inventory

| State | Policy | Recovery treatment |
|---|---|---|
| Production PostgreSQL | BACKUP_REQUIRED | Custom-format logical dump, checksum and manifest |
| Repository source | BACKUP_REQUIRED | Git remote plus immutable checkpoint; do not duplicate `.git` into the DB archive |
| Remediation/governance docs | BACKUP_REQUIRED | Git-tracked source; manifest records Git HEAD and program states |
| Canonical configuration | BACKUP_REQUIRED | Git-tracked non-secret configuration |
| Artifact metadata and lineage | BACKUP_REQUIRED | PostgreSQL dump |
| Canonical local provenance files | BACKUP_REQUIRED | Deterministic allowlist; currently final Program-4 media and caption sidecar |
| Other generated media/output | OPTIONAL | Retain only by an approved artifact lifecycle/object-storage policy |
| Runtime state, jobs, receipts and audits | BACKUP_REQUIRED when canonical | PostgreSQL dump; external receipt stores need their own policy |
| Credential bindings and health history | BACKUP_REQUIRED | Metadata, opaque references and audit history in PostgreSQL |
| `.env`, passwords, OAuth material, API keys | EXTERNAL_OWNER_MANAGED | Never included in the ordinary backup set |
| `D:\AMF-Secrets` and Owner credential files | EXTERNAL_OWNER_MANAGED | Owner restores securely and rebinds/verifies after disaster |
| Logs | OPTIONAL | Separate log-retention policy; not required for canonical-state restore |
| Scratch, caches, build output and temp files | EXCLUDE | Rebuild or discard; never include by broad directory copy |

The operator does not archive `output/` wholesale. It reads the canonical
final-media record, verifies the referenced file against its stored SHA-256,
and copies only the approved critical media and caption sidecar. Additional
production artifacts require an explicit allowlist and hash check.

## 2. Prerequisites

- PostgreSQL client tools compatible with the server (`pg_dump`, `pg_restore`,
  `createdb`); the certified host uses PostgreSQL 18 tooling.
- Repository `.env` available locally with `DATABASE_URL`. It is read but never
  copied or printed.
- The production database reachable read-only for backup.
- An external destination. Default: `D:\AIWorkspace\AMF-Backups`.
- Space for the dump, manifest and explicitly allowlisted files.

## 3. Create a production backup

From the repository root:

```powershell
node scripts/amf-backup.mjs
```

Optional approved external destination:

```powershell
node scripts/amf-backup.mjs --dir D:\Approved-AMF-Backups
```

The operator uses `pg_dump --format=custom`, supplies the password to the child
process only through `PGPASSWORD`, and writes `<BACKUP_ID>.dump`,
`<BACKUP_ID>.manifest.json`, and `<BACKUP_ID>.files\`. It fails closed for an
in-repository destination, missing/hash-mismatched critical media, dump failure,
or a known secret value found in the resulting set.

## 4. Manifest and checksum verification

The manifest records safe DB fingerprint/name/version, Git HEAD, schema
fingerprint/object counts, dump size/SHA-256, critical IDs/counts, file hashes,
program states and governance state. It contains no URL password or raw
credential.

```powershell
Get-FileHash D:\AIWorkspace\AMF-Backups\<BACKUP_ID>.dump -Algorithm SHA256
```

The result must equal `dump.sha256`. The restore verifier checks hash, size and
source fingerprint again before creating a database.

## 5. Secret-handling rules

Ordinary sets exclude raw OAuth access/refresh tokens, client secrets, `.env`,
DB passwords, RunPod management keys, GitHub/GHCR auth and Authorization
headers. `credential_bindings` restores metadata and opaque external references
only. After disaster recovery the Owner separately restores the approved
secret store/`.env`, external credential files and permissions, then performs
one bounded credential-health verification before provider operations resume.
Google OAuth remains `EXTERNAL_TESTING` until separately productionized.

## 6. Isolated restore drill

Use a never-before-used target matching
`ai_media_factory_restore_test_[a-z0-9_]+`:

```powershell
node scripts/amf-restore-verify.mjs `
  --file D:\AIWorkspace\AMF-Backups\<BACKUP_ID>.dump `
  --manifest D:\AIWorkspace\AMF-Backups\<BACKUP_ID>.manifest.json `
  --target ai_media_factory_restore_test_<timestamp>
```

The verifier refuses production, `postgres`, `ai_media_factory_test`,
nonconforming names, matching production fingerprints, existing targets,
wrong checksums and backups from another source identity. It creates a new DB,
restores without `--clean`, validates schema/records/lineage/governance, and
writes `<BACKUP_ID>.restore-report.json`.

## 7. Temporary application verification

When safe, start the Node API on a non-production port with `DATABASE_URL`
rewritten to the isolated DB. Never repoint production services. Verify GET
health, projects, onboarding, credential metadata, next cycle, artifacts and
budgets; execute no POST; stop it immediately. The canonical 2026-10-01 drill
used port 18081, got HTTP 200 for all listed reads, and stopped the process. Startup's
canonical `migrate()` added the source-owned
`uq_review_resume_idempotency_identity` index to the isolated copy (161 to 162
indexes). Production was not changed. This proves application boot but also
records an outstanding narrow production-schema migration gate before the next
real cycle.

## 8. Production disaster restore procedure

This is a controlled procedure, not standing authorization.

1. Obtain written Owner authorization naming backup ID, target, incident and
   cutover window.
2. Stop worker, Node API and AMF Control canonically; confirm no active work.
3. Preserve the failed production DB; never truncate/overwrite it in place.
4. Run the isolated drill and require every assertion to pass.
5. A DBA creates a new recovery DB and restores the verified dump. The repo
   verifier intentionally exposes no production-restore switch.
6. Validate hash, schema, critical IDs, lineage, governance, routing and budgets.
7. Restore Owner-managed secrets separately.
8. Change the production DB binding only during the authorized cutover; retain
   the prior DB for rollback.
9. Start DB, Node API, AMF Control, then singleton worker; verify source and DB
   identities.
10. Verify read-only Owner screens before any state-changing action.
11. Keep automation OFF/L0_MANUAL/DISABLED, Wan blocked and providers gated.

Abort/rollback the binding if validation fails, critical lineage is absent,
governance becomes permissive, secrets are unavailable or runtime DB identities
disagree. Only the Owner can authorize disposal of the failed DB.

## 9. Post-restore verification

- schema/index/constraint counts and fingerprint match;
- Morroway ACTIVE, automation OFF/L0_MANUAL/DISABLED;
- final-media→publication→observation→learning→recommendation→proposal resolves;
- proposal `ncp-294f1942f013` is `OWNER_DEFERRED`;
- Job 68 is failed/18 with workflow CANCELLED;
- Research Pilot workflow is PAUSED and registry says CLOSED/NO_PRODUCTION_CANDIDATE;
- credential metadata/history exists; secrets come only from Owner storage;
- future Wan submissions remain forbidden.

## 10. Retention proposal (not scheduled)

- retain 7 daily successful sets;
- retain 4 end-of-week sets;
- retain 12 end-of-month sets;
- retain latest pre-deployment/pre-migration and incident evidence until release.

Scheduling, off-host replication and encryption-key custody require separate
authorization. One local disk is not complete disaster recovery.

## 11. Initial RPO/RTO baseline

The canonical 2026-10-01 exported-snapshot drill produced a 37,934,592-byte
dump in 3.213 seconds, restored in 3.504 seconds and validated in 0.120 seconds.
These are measurements, not an
SLA. Proposed RPO is <=24 hours after separately authorized daily scheduling;
while manual, actual RPO is time since last successful set. Proposed Owner-led
RTO is <=4 hours including authorization, secret re-binding and cutover; the
DB-only restore-plus-validation baseline is 3.624 seconds.

## 12. Evidence and cleanup

Backup: `amf-backup-2026-09-30T22-17-37-348Z`.  
Restore DB: `ai_media_factory_restore_test_20261001_001737`.  
Disposition: `PRESERVED_FOR_EVIDENCE`. Do not drop it or delete the backup
without a separately recorded Owner-approved cleanup.

The additive Program-3 review-resume idempotency migration was separately
Owner-authorized, applied and verified on 2026-10-01. The backup above remains
the immutable pre-migration recovery point. No broad migration bootstrap was
used. Before a first bounded cycle, refresh the canonical worker and verify its
build/singleton identity against current source.

Object-storage integration: DB backup contains storage metadata/receipts only;
durable binaries must be protected by the selected object's versioning and
replication policy. After restore, verify every current durable receipt with
provider `head/get` and SHA-256 before provider operations resume. See
`AMF_OBJECT_STORAGE_AND_RETENTION_RUNBOOK.md`. No provider is selected yet.
