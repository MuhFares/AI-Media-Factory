# Security Boundaries

> Design only. No logic. The rules the Memory Engine enforces so memory stays trustworthy and no agent can bypass it.

## The core boundary

**Agents never access memory files or backing stores directly.** The `MemoryEngine` facade is the only door. This is the entire reason the engine exists — it is the single point where access control, provenance, versioning, and durability rules are enforced.

## Enforced rules

| Boundary | Rule |
|---|---|
| **Scoped access** | Each agent may read/write only the memory types its config permits. The engine rejects out-of-scope access. |
| **Single-writer** | An agent writes only the memory it owns. Cross-agent knowledge flows as events, never as a direct write into another agent's memory. |
| **Permanent-type protection** | Company / Decision / Lessons memory cannot be deleted or blind-overwritten — append/supersede only. |
| **Provenance required** | A write without `sources` + `derived_by` is rejected (req #14). |
| **Secret hygiene** | Memory bodies are validated; secrets are never stored in records or logs. Backing-store credentials come from the environment ([`configs/environments`](../../../configs/environments/README.md)). |
| **Audit trail** | Every write, supersede, delete-attempt (including refused ones), and conflict resolution is logged with correlation ids. |
| **Confidentiality of retrieval** | An agent's query returns only records within its readable scope; brand isolation is preserved (one brand cannot read another's private memory unless the type is company-wide). |

## Why this matters

For the enterprise buyers AMF targets, memory must be governable and auditable: "who wrote this, from what evidence, when, and who could read it?" The facade + these boundaries are what make that answerable, and what stop an autonomous fleet from corrupting or leaking its own knowledge.
