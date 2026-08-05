# Storage

This directory is the artifact and working-data plane for the AI Media Factory platform. It holds the runtime outputs and intermediate working data produced while workflows execute: cached computations, exported deliverables, rendered media, queued job payloads, and reusable content templates.

Contents are runtime-generated and git-ignored; this README and .gitkeep anchor the folder.

## Purpose

The storage plane separates ephemeral and generated runtime artifacts from version-controlled source code. Services and workers read from and write to these subfolders during normal operation. None of the generated contents are committed to version control.

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| `cache/` | Transient cache for API responses, embeddings, and intermediate computations. |
| `exports/` | Finished, exportable deliverables such as reports, data extracts, and published-content bundles. |
| `renders/` | Rendered media output from the worker, including video, image, and audio renders. |
| `queue/` | Durable queue spool and job payloads for the task queue and event bus. |
| `templates/` | Reusable content templates, organized by target platform. |
