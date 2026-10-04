# Program 6 Wan Predeployment Bootstrap

Task: `AMF_PROGRAM_06_WAN_PREDEPLOYMENT_BOOTSTRAP_V1`  
Date: 2026-09-30  
Result: `PARTIAL_EXTERNAL_OWNER_PREREQUISITES_REQUIRED`

No RunPod management request, endpoint mutation, image push, generation,
workflow execution, production database mutation, or budget mutation occurred.

## Owned handler checkpoint

- Source commit: `0cfde0d` (`feat(wan): checkpoint hardened RunPod video handler`).
- Source directory: `experimental/wan2.2-i2v-v1/`.
- Included source: `handler.py`, `receipt_store.py`.
- Included tests: `tests/test_handler.py`.
- Included build assets: `.dockerignore`, `Dockerfile`, `requirements.txt`,
  `start.sh`, `extra_model_paths.yaml`, `workflow_api.json`, and the existing
  GHCR GitHub Actions workflow.
- Included source documentation: `README.md`.
- Excluded generated/local content: Python bytecode and `__pycache__`.
- Excluded historical/local evidence: `FORENSIC.md` and
  `workflow_api.json.bak`.
- Secret scan: PASS; no credential, token, private key, authenticated database
  URL, or secret-bearing local file was committed.
- Zero-GPU handler suite: 13/13 PASS. Python compilation, workflow JSON, and
  GitHub workflow YAML validation passed. A local Docker build was not possible
  because Docker is not installed on this operator host.

The checkpoint additionally supplies the previously missing container
entrypoint, RunPod serverless startup, ComfyUI readiness wait, persistent
receipt-path guard, model-volume mapping, immutable custom-node commit pins,
and GitHub Actions digest reporting.

## Image build path

Canonical workflow:
`.github/workflows/build-amf-wan22-i2v.yml` (`workflow_dispatch`). It builds
`experimental/wan2.2-i2v-v1`, pushes to
`ghcr.io/muhfares/amf-wan22-i2v`, tags `sha-<full commit SHA>`, passes the
source revision as an OCI label, and writes the resulting digest to the GitHub
Actions job summary.

GitHub Actions cannot build the local-only commit. Owner authorization is
required to push it. Safe command from the repository root:

```powershell
git push origin main
```

After push, use GitHub → Actions → **Build AMF Wan2.2 I2V v1** → **Run
workflow** on `main`. Do not deploy from a tag alone. Record the exact
`sha256:...` digest from the job summary as
`RUNPOD_VIDEO_HANDLER_IMAGE_DIGEST`. The workflow uses the repository-scoped
`GITHUB_TOKEN` with `packages: write`; actual GHCR publication permission is
not proven until the workflow completes.

## RunPod management credential

Canonical environment name: `RUNPOD_MANAGEMENT_API_KEY`.

This must be an external/local secret, separate in purpose from the generation
transport credential. It must never be committed or printed.

Owner steps:

1. Open RunPod Console → Settings → API Keys.
2. Create a dedicated management key. Use the minimum permissions available
   that allow endpoint, template and network-volume inspection. Endpoint or
   template update permission is needed only for the later, separately
   authorized deployment mutation.
3. Store it only in the ignored local `.env` as
   `RUNPOD_MANAGEMENT_API_KEY=<secret>` or the approved external secret store.
4. Verify presence without revealing the value:

```powershell
node --env-file=.env -e "console.log(process.env.RUNPOD_MANAGEMENT_API_KEY ? 'PRESENT' : 'ABSENT')"
```

No authenticated management inspection was performed in this bootstrap.

## Network volume and endpoint inspection

Target endpoint: `ry49lc45y50ldy`. Current template, image, GPU/scaling and
region identities remain `UNKNOWN` until authenticated read-only inspection.

The Owner must first open RunPod Console → Serverless → Endpoints →
`ry49lc45y50ldy` and record, without exposing secrets:

- template ID and current container image;
- network-volume attachment and its region/datacenter;
- GPU configuration and worker scaling parameters;
- environment variable names (values remain redacted).

Then create or select a persistent network volume compatible with that exact
endpoint/template region and GPU availability. Do not choose an arbitrary
region. Attach it through the endpoint/template management surface and record
its ID externally as `RUNPOD_VIDEO_NETWORK_VOLUME_ID`.

Required container layout:

```text
/runpod-volume/amf-video-receipts
/runpod-volume/models/
```

Set the endpoint environment name
`AMF_VIDEO_RECEIPT_DIR=/runpod-volume/amf-video-receipts`. Model files must be
placed under the subdirectories declared by `extra_model_paths.yaml` before a
worker can pass readiness. Volume creation/attachment and endpoint changes are
not authorized by this bootstrap.

The current repository has a guarded local preflight and a GitHub image build
operator, but no authenticated RunPod endpoint-inspection/update operator.
Until an API contract is separately added and verified, the canonical
inspection path is the RunPod Console read-only view. Do not invent a GraphQL
mutation or reuse the generation endpoint credential silently.

## Immutable identity

- `WAN_SOURCE_COMMIT = 0cfde0d...`.
- `WAN_SOURCE_BUILD_ID` is the deterministic SHA-256 of the committed handler
  tree manifest, recorded in the task report.
- `WAN_IMAGE_TAG = ghcr.io/muhfares/amf-wan22-i2v:sha-<full commit SHA>`.
- `WAN_IMAGE_DIGEST` must be the `sha256:...` output of the completed GitHub
  Actions build.

Deployment certification must compare the endpoint-resolved image digest to
that exact build digest. A mutable tag or tag-only match is insufficient.

## Predeployment gates

1. A — source committed: PASS.
2. B — image build path ready: PASS, push/dispatch still required.
3. C — immutable image digest available: BLOCKED.
4. D — management API key configured: BLOCKED.
5. E — management authentication verified: BLOCKED.
6. F — compatible network-volume ID available: BLOCKED.
7. G — persistent receipt directory configured: SOURCE_READY / DEPLOYMENT_BLOCKED.
8. H — endpoint/template inspectable: BLOCKED.
9. I — source/image/endpoint digest parity ready: BLOCKED.
10. J — AMF worker refresh ready: REQUIRED; not executed.
11. K — zero generation calls: PASS.

`FUTURE_WAN_SUBMISSIONS_ALLOWED = NO`. Deployment mutation and generation
remain separately authorized operations.
