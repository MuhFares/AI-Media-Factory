# AMF Object Storage and Output Retention Runbook

Status: `PROVIDER_FREE_DESIGN_PASS` on 2026-10-01. No production provider has
been selected, no binary has been migrated, and no local output has been
deleted. This runbook defines the contract and gates for a later authorized
deployment.

## 1. Current inventory and classification

Observed local footprint:

- `output/`: 706 files, 347,094,901 bytes.
- `artifacts/`: 180 files, 40,261,474 bytes.
- `logs/`: 21 files, 147,334 bytes.
- Total measured generated/evidence footprint: 387,503,709 bytes (0.388 GB
  decimal / 0.361 GiB).

| Current state | Classification | Future treatment |
|---|---|---|
| PostgreSQL `artifacts`, observations, learning, audits | DB_ONLY_METADATA | Backup DB; binary location lives in a separate receipt row |
| Final media and published-source media | DURABLE_BINARY_REQUIRED | Promote as `PUBLISHED_MEDIA` before publication |
| Approved scene images, narration, captions and clips needed for reproducibility | DURABLE_BINARY_REQUIRED | `CANONICAL_DURABLE` while referenced |
| Program-4 canary media and immutable proof packets | HISTORICAL_EVIDENCE | Hash-verified immutable retention |
| Raw provider outputs with unresolved ACK/reconciliation | HISTORICAL_EVIDENCE until resolved | Never clean while recovery/reconciliation is open |
| Compose scratch, padded/stitch intermediates and transient downloads | TEMPORARY_WORKING_FILE | `EPHEMERAL_WORK`; cleanup only after promotion gates pass |
| Render/cache derivatives reproducible from durable inputs | REGENERABLE | `REGENERABLE_CACHE` |
| `output/` and `artifacts/` paths today | LOCAL_ONLY | Legacy transport/cache location, not canonical identity |
| Analytics observations, learning and recommendations | DB_ONLY_METADATA | Must retain artifact IDs/hashes; no dependence on local paths |
| Operational logs | LOCAL_ONLY / OPTIONAL | 30-day operational retention; canonical audits remain in DB |
| PID files, build caches and temporary runtime files | TEMPORARY_WORKING_FILE | No durability claim; safe cleanup still requires scoped operator |
| Unknown/unclassified generated files | UNKNOWN | Do not promote or delete until classified |

Large observed groups include MP4 (169.8 MB), PNG (146.6 MB across `output`
and `artifacts`), WAV (21.8 MB) and HTML proof/benchmark output (39.0 MB).
These measurements describe the current mixed proof/development corpus, not a
production lifecycle policy.

## 2. Canonical storage contract

Artifact identity is immutable and location-independent:

```text
artifactId + sha256 + byteCount + mimeType + project/content/execution lineage
```

Transport is a short-lived resolved read mechanism:

```text
LOCAL_TEST_REFERENCE | SIGNED_HTTPS | PROVIDER_REFERENCE
```

Storage location is replaceable and versioned:

```text
storageProvider + storageKey + optional localCachePath + verified receipt
```

The canonical record contains:

- `artifact_id`, `sha256`, `byte_count`, `mime_type`;
- `storage_class`, `storage_provider`, `storage_key`, `local_cache_path`;
- `source_execution_id`, `project_id`, `content_id`, `created_at`;
- `retention_class`, `durability_status`, `verified_at`, receipt evidence.

Local paths never identify an artifact. The content address is
`sha256:<digest>`. Default provider-neutral object key:
`<projectId>/<first-two-hash-characters>/<full-sha256>`.

## 3. Storage classes and retention

| Class | Backup/replication | Retention | Deletion authority | Restore expectation |
|---|---|---|---|---|
| `EPHEMERAL_WORK` | No | 24 hours after successful durable promotion and closed recovery | Policy operator after all cleanup gates | Not restored |
| `REGENERABLE_CACHE` | No | 7 days since last access/use | Policy operator; inputs and recipe must remain durable | Rebuild on demand |
| `CANONICAL_DURABLE` | Yes, replicated | While referenced, then minimum 1 year | Owner-approved lifecycle policy | Must resolve and hash-verify |
| `PUBLISHED_MEDIA` | Yes, replicated | Publication lifetime plus 7 years | Explicit Owner approval and publication lifecycle closure | Required before publication service recovery |
| `HISTORICAL_EVIDENCE` | Yes, replicated/immutable | Minimum 7 years; canary/incident evidence indefinite unless Owner releases | Explicit Owner evidence-disposition decision | Must remain readable and hash-valid |

Specific policy:

- raw provider output: 30 days after reconciliation closes; indefinitely while
  ambiguous or referenced by recovery;
- intermediate images/clips: 30 days after durable final promotion, longer
  while an approval/recovery remains open;
- narration and captions: keep while final/published media is referenced, then
  minimum 1 year;
- final media: minimum 1 year when unpublished; published media follows the
  publication-lifetime-plus-7-years class;
- private canary and certification media: immutable historical evidence;
- logs: 30 days locally; audit/domain records follow DB retention;
- temporary caches: 7 days; compose scratch: 24 hours after verified promotion.

Nothing is scheduled or deleted by this design task.

## 4. Provider-neutral adapter

`ObjectStorageAdapter` supports:

- `put` with pre-write hash/byte validation and durable receipt;
- `head`, `get`, `exists` and post-read hash verification;
- guarded `delete`;
- a resolved read/signed transport reference.

The interface can be implemented by S3-compatible stores, Cloudflare R2,
Backblaze B2, AWS S3, MinIO, or another provider without changing artifact
identity. Production provider is `NOT_SELECTED`.

The provider-free `LocalDurableObjectStorage` requires an explicit test-only
acknowledgement, absolute isolated root, content-addressed keys, atomic writes
and sidecar receipts. It refuses normal `output`, `artifacts` and `storage`
roots. It is certification infrastructure, not a production durability claim.

## 5. Promotion flow

```text
working file
  → technical validation
  → calculate full SHA-256 and byte count
  → assign artifact identity and retention class
  → object-store put
  → head/get and hash verification
  → persist VERIFIED storage receipt + artifact lineage atomically
  → resolve transport only from artifact identity + verified receipt
  → local path becomes optional cache
```

No artifact is canonical durable before its bytes, declared size and SHA-256
agree. Duplicate content is idempotent and resolves to one content-addressed
object; different artifacts may reference the same object without sharing
artifact identity.

## 6. Cleanup gates

Deletion requires all of the following:

1. a `VERIFIED` durable copy exists;
2. a fresh `head/get` hash equals the canonical hash;
3. artifact/storage receipt lineage is persisted;
4. retention window has elapsed;
5. object is not immutable evidence;
6. no unresolved recovery, ambiguity, publication or reconciliation references it;
7. Owner authorization exists where the class requires it;
8. deletion targets an exact storage key/hash, never a broad folder.

The adapter rejects deletion unless every guard is supplied. There is no blind
folder cleanup and no cleanup was run during certification.

## 7. Database model and migration

The existing `artifacts.payload` can carry legacy local paths but cannot safely
represent replaceable providers, multiple location generations, durability
state and retention. The additive `artifact_storage_records` table separates
those concerns and references canonical `artifacts(artifact_id)`.

Source and a narrow idempotent migration are prepared. Isolated PostgreSQL
tests prove table/index creation, current-location uniqueness and fail-closed
byte-count constraints. Production migration is not authorized or applied.

## 8. Backup and restore interaction

The PostgreSQL backup contains artifact identity, lineage and storage receipts,
not binary object contents. Object storage owns durable binaries. A recoverable
system therefore needs both:

1. the DB backup/manifest; and
2. object-store durability/versioning/replication evidence.

After DB restore, enumerate every current record whose class is
`CANONICAL_DURABLE`, `PUBLISHED_MEDIA` or `HISTORICAL_EVIDENCE`; call `head`,
compare byte count/hash/metadata, then sample or fully `get` and hash according
to incident scope. Any missing/corrupt object blocks provider/publication
operations. External storage credentials remain Owner-managed secrets.

The existing backup runbook remains authoritative for DB restore. It must be
extended with an object inventory manifest only after a production provider is
selected and live storage receipts exist.

## 9. Publication and analytics integration

Future publication must bind `finalMediaArtifactId` and SHA-256, load its
current `VERIFIED` durable receipt, verify adapter `head`, then resolve a
short-lived transport. Arbitrary browser/local paths are not accepted as
identity. `resolveDurablePublicationTransport` provides this provider-free
boundary; legacy local-file publication remains historical compatibility until
a separately certified cutover.

`published_report`, `performance_observation`, `learning_record`, recommendation
and next-cycle proposal already join by canonical IDs/hashes. Their lineage
survives local cache removal because none should join on a filesystem path.

## 10. Incident recovery

- Mark failed `head/get` as `MISSING` or `CORRUPT`; do not substitute another
  object by filename.
- Stop publication/promotion for affected artifacts.
- Recover by exact SHA-256 from versioned replica/backup, re-verify, and append
  a new receipt/location generation.
- Preserve the previous receipt and incident evidence.
- Never rewrite artifact identity or historical publication/analytics lineage.

## 11. Provider migration strategy

1. Select and authorize a target provider and region/account policy.
2. Create an adapter implementation and provider-free contract suite.
3. Copy each object by canonical key without deleting the source.
4. Verify destination `head/get`, bytes and SHA-256.
5. Persist a new storage receipt as current while preserving old receipt history.
6. Dual-read/canary the destination.
7. Retire the old location only after retention and Owner cleanup gates pass.

## 12. Capacity scenarios

Measured averages are noisy because the current corpus mixes tests, proofs and
production-like output. A conservative short-video planning unit is 15 MB:

- final media: 4.0 MB;
- intermediate clips: 7.0 MB;
- images and audio: 3.9 MB;
- receipts/captions/metadata: 0.1 MB.

| Videos | Final | Intermediates | Images/audio | Receipts | Total |
|---:|---:|---:|---:|---:|---:|
| 100 | 0.40 GB | 0.70 GB | 0.39 GB | 0.01 GB | 1.50 GB |
| 1,000 | 4.0 GB | 7.0 GB | 3.9 GB | 0.1 GB | 15.0 GB |
| 10,000 | 40 GB | 70 GB | 39 GB | 1 GB | 150 GB |

These are capacity estimates, not provider price estimates. Replication,
versioning and temporary dual-provider migration can multiply physical storage;
plan at least 2× logical capacity when selecting a provider.

## 13. Re-entry gates

Before live durability can be claimed:

- select/authorize provider, region, encryption and credentials;
- apply the additive storage schema under separate production authorization;
- implement and certify the chosen adapter;
- migrate one bounded artifact with no source deletion;
- verify restore/inventory behavior and publication resolution;
- define scheduled integrity audit and storage lifecycle;
- only then migrate production media or enable cleanup.
