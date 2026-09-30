/**
 * Strategic Operating Layer V1 — first-class governed strategic state.
 *
 * Versions are immutable rows. Activation flows: proposal -> Owner approval
 * (canonical control_approvals with STRATEGY_ACTIVATION scope) -> activation.
 * Active-state changes never rewrite historical lineage: executions reference
 * immutable context snapshots by ID + hash.
 *
 * Deterministic, provider-free: no LLM, no network, no budget consumed.
 */

import type pg from "pg";
import { createHash } from "node:crypto";

export type StrategicEntityType =
  | "STRATEGY" | "BRAND" | "CONTENT_SYSTEM" | "OBJECTIVES" | "PRINCIPLES"
  | "CONSTRAINTS" | "EXPERIMENT" | "DECISION" | "LEARNING_MEMORY";

export type StrategicStatus = "DRAFT" | "PROPOSED" | "ACTIVE" | "SUPERSEDED" | "RETIRED";

export const STRATEGIC_ENTITY_TYPES: readonly StrategicEntityType[] = [
  "STRATEGY", "BRAND", "CONTENT_SYSTEM", "OBJECTIVES", "PRINCIPLES",
  "CONSTRAINTS", "EXPERIMENT", "DECISION", "LEARNING_MEMORY",
];

/** Entity types that permit multiple concurrent ACTIVE rows per project/key. */
const MULTI_ACTIVE_TYPES: ReadonlySet<string> = new Set(["EXPERIMENT", "DECISION"]);

export const STRATEGIC_RESOLVER_VERSION = "strat-resolver-v2";
export const STRATEGIC_SCHEMA_VERSION = "strategic-v1";
/** Governed bound on serialized resolved context (bytes). Oversize fails closed. */
export const STRATEGIC_CONTEXT_MAX_BYTES = 8000;

export interface StrategicEntity {
  entityId: string; projectId: string; entityType: StrategicEntityType;
  entityKey: string; version: number; status: StrategicStatus;
  payload: Record<string, unknown>; schemaVersion: string;
  sourceArtifactIds: string[]; supersedesVersion: number | null;
  createdBy: string; createdAt: string;
  activatedAt: string | null; activatedByApprovalId: string | null;
}

export interface StrategicActivation {
  activationId: string; entityId: string; projectId: string;
  entityType: StrategicEntityType; entityKey: string; version: number;
  approvalId: string; activatedBy: string; activatedAt: string;
  previousActiveVersion: number | null;
}

export interface StrategicIteration {
  iterationId: string; projectId: string;
  entityType: StrategicEntityType; entityKey: string;
  priorVersion: number; newEntityId: string; newVersion: number;
  sourceDecisionId: string; ownerRationale: string;
  createdBy: string; createdAt: string;
}

export interface StrategicSnapshot {
  snapshotId: string; projectId: string; taskClass: string; agentId: string | null;
  entityRefs: Array<{ entityId: string; entityType: string; entityKey: string; version: number }>;
  context: Record<string, unknown>; contextHash: string;
  resolverVersion: string; createdAt: string;
}

/** Task-aware relevance: which strategic classes each task role receives. */
const TASK_RELEVANCE: Record<string, readonly StrategicEntityType[]> = {
  research: ["STRATEGY", "OBJECTIVES", "CONSTRAINTS", "EXPERIMENT", "DECISION"],
  planner: ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "CONSTRAINTS", "EXPERIMENT", "DECISION"],
  writer: ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "CONSTRAINTS", "EXPERIMENT"],
  seo: ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "OBJECTIVES", "CONSTRAINTS"],
  "visual-director": ["BRAND", "CONTENT_SYSTEM", "CONSTRAINTS"],
  ceo: ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "OBJECTIVES", "PRINCIPLES", "CONSTRAINTS", "EXPERIMENT", "DECISION", "LEARNING_MEMORY"],
  default: ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "CONSTRAINTS"],
};

function taskClassForAgent(agentId: string | null | undefined): string {
  const a = (agentId ?? "").toLowerCase();
  if (a === "research") return "research";
  if (a === "planner" || a === "planner-initial" || a === "planner-synthesis") return "planner";
  if (a === "writer") return "writer";
  if (a === "seo") return "seo";
  if (["director", "video", "scene-image", "media", "thumbnail"].includes(a)) return "visual-director";
  if (["ceo"].includes(a)) return "ceo";
  return "default";
}

/** Deterministic serialization: recursively sorted keys, stable for hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function strategicContextHash(context: unknown): string {
  return createHash("sha256").update(canonicalJson(context)).digest("hex");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "k";
}

const rowToEntity = (r: Record<string, unknown>): StrategicEntity => ({
  entityId: String(r.entity_id), projectId: String(r.project_id),
  entityType: String(r.entity_type) as StrategicEntityType, entityKey: String(r.entity_key),
  version: Number(r.version), status: String(r.status) as StrategicStatus,
  payload: (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>,
  schemaVersion: String(r.schema_version),
  sourceArtifactIds: (typeof r.source_artifact_ids === "string" ? JSON.parse(r.source_artifact_ids) : r.source_artifact_ids ?? []) as string[],
  supersedesVersion: r.supersedes_version === null || r.supersedes_version === undefined ? null : Number(r.supersedes_version),
  createdBy: String(r.created_by), createdAt: String(r.created_at),
  activatedAt: r.activated_at === null || r.activated_at === undefined ? null : String(r.activated_at),
  activatedByApprovalId: r.activated_by_approval_id === null || r.activated_by_approval_id === undefined ? null : String(r.activated_by_approval_id),
});

// -- task-aware strategic context projection ------------------------------------

/**
 * Slice 6 budget remediation — deterministic projection policy.
 *
 * Pipeline: canonical ACTIVE truth (complete, immutable) -> per-domain
 * compact fact extraction (explicit field allowlists, never text
 * summarization) -> task-class domain selection -> required-semantic
 * validation -> byte budget validation -> frozen projected context with
 * full provenance. Pure: no DB, no network, no LLM. Fail-closed: unknown
 * entity types, missing required facts, and over-budget projections all
 * throw before any provider call.
 */
export const STRATEGIC_PROJECTION_POLICY_VERSION = "strat-projection-v1";

/**
 * Execution-context byte budget. Same number as the legacy canonical cap,
 * enforced on the projected context agents actually receive (canonical
 * truth itself is the unbounded-bytes source and is never injected raw).
 */
export const STRATEGIC_PROJECTED_CONTEXT_MAX_BYTES = STRATEGIC_CONTEXT_MAX_BYTES;

export interface StrategicProjectionMeta {
  policyVersion: string;
  taskClass: string;
  sourceEntities: string[];
  sourceVersions: string[];
  byteCount: number;
  requiredSemanticChecks: string[];
  projectionHash: string;
}

export interface StrategicProjectedContext {
  taskClass: string;
  domains: Record<string, Record<string, unknown>>;
  missingDomains: string[];
  authority: Record<string, unknown>;
}

type Payload = Record<string, unknown>;
const asRecord = (v: unknown): Payload | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : null;
const asString = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const asStringArray = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") ? (v as string[]) : null;
const pick = (p: Payload, ...keys: string[]): unknown => {
  let cur: unknown = p;
  for (const k of keys) {
    const r = asRecord(cur);
    if (!r || !(k in r)) return undefined;
    cur = r[k];
  }
  return cur;
};
const setIf = (into: Record<string, unknown>, key: string, value: unknown): void => {
  if (value !== undefined && value !== null) into[key] = value;
};

/** Compact fact extractors, one per known domain. Unknown types fail closed. */
function extractFacts(entityType: string, payload: Payload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (entityType === "STRATEGY") {
    setIf(out, "pillars", asStringArray(payload.contentPillars));
    setIf(out, "pilotModel", asString(pick(payload, "pilot", "model")));
    setIf(out, "learningBatch", pick(payload, "pilot", "learningBatch"));
    setIf(out, "learningBatchNote", asString(pick(payload, "pilot", "learningBatchNote")));
    setIf(out, "gatesNote", asString(pick(payload, "pilot", "gatesNote")));
    setIf(out, "approvalBasis", asString(pick(payload, "pilot", "approvalBasis")));
    setIf(out, "platformsPrimary", asString(pick(payload, "platforms", "primary")));
    setIf(out, "expansionRule", asString(pick(payload, "platforms", "expansionRule")));
    setIf(out, "format", (() => {
      const f = asRecord(payload.format);
      if (!f) return undefined;
      const compact: Record<string, unknown> = {};
      setIf(compact, "direction", asString(f.direction));
      setIf(compact, "reel", asString(f.reel));
      setIf(compact, "aiVisual", asString(f.aiVisual));
      setIf(compact, "note", asString(f.note));
      return Object.keys(compact).length ? compact : undefined;
    })());
    setIf(out, "ownerDecision", asString(payload.ownerDecision));
    setIf(out, "councilStatus", asString(payload.councilStatus));
    setIf(out, "essence", asString(payload.essence));
    return out;
  }
  if (entityType === "BRAND") {
    setIf(out, "brand", asString(payload.brand));
    setIf(out, "brandStatus", asString(payload.brandStatus));
    setIf(out, "namingStatus", asString(pick(payload, "naming", "status")));
    setIf(out, "namingWinner", asString(pick(payload, "naming", "winner")));
    setIf(out, "essence", asString(payload.essence));
    setIf(out, "identityPrimary", asString(pick(payload, "identityDirection", "primary")));
    setIf(out, "identitySecondary", asString(pick(payload, "identityDirection", "secondary")));
    setIf(out, "identityStatus", asString(pick(payload, "identityDirection", "status")));
    setIf(out, "logoStatus", asString(pick(payload, "logo", "status")));
    setIf(out, "paletteStatus", asString(pick(payload, "palette", "status")));
    setIf(out, "typographyStatus", asString(pick(payload, "typography", "status")));
    setIf(out, "taglineStatus", asString(pick(payload, "tagline", "status")));
    setIf(out, "handleStatus", asString(pick(payload, "handle", "status")));
    setIf(out, "domainStatus", asString(pick(payload, "domain", "status")));
    setIf(out, "trademarkStatus", asString(pick(payload, "trademark", "status")));
    setIf(out, "legalStatus", asString(pick(payload, "legalEntity", "status")));
    setIf(out, "positioning", asString(payload.positioning));
    return out;
  }
  if (entityType === "CONTENT_SYSTEM") {
    setIf(out, "status", asString(payload.status));
    setIf(out, "decisionModel", asStringArray(payload.decisionModel));
    setIf(out, "pilotModel", asString(pick(payload, "pilot", "model")));
    setIf(out, "pilotState", asString(pick(payload, "pilot", "state")));
    setIf(out, "learningBatchNote", asString(pick(payload, "learningBatch", "note")));
    setIf(out, "learningBatchIds", (() => {
      const items = pick(payload, "learningBatch", "items");
      if (!Array.isArray(items)) return undefined;
      const ids = items.map((i) => asString(asRecord(i)?.id)).filter((x): x is string => x !== null);
      return ids.length ? ids : undefined;
    })());
    setIf(out, "sourcingHistorical", asString(pick(payload, "sourcing", "historicalPov")));
    setIf(out, "sourcingFantasy", asString(pick(payload, "sourcing", "fantasy")));
    setIf(out, "gatesNote", asString(pick(payload, "gates", "note")));
    setIf(out, "qaRequired", typeof payload.qaRequired === "boolean" ? payload.qaRequired : pick(payload, "governance", "qaRequired") === true ? true : undefined);
    setIf(out, "publicationMode", asString(pick(payload, "governance", "publicationPolicy", "currentMode")));
    setIf(out, "publicationRule", asString(pick(payload, "governance", "publicationPolicy", "rule")));
    setIf(out, "autonomyRule", asString(pick(payload, "governance", "publicationPolicy", "autonomousPublication")));
    setIf(out, "durationRule", asString(pick(payload, "durationSemantics", "rule")));
    return out;
  }
  if (entityType === "CONSTRAINTS") {
    const rules = asStringArray(payload.rules);
    // Legacy shape tolerance: single-string rules field (never silently dropped).
    const single = asString(payload.rules);
    if (rules) setIf(out, "rules", rules);
    else if (single) setIf(out, "rules", [single]);
    return out;
  }
  if (entityType === "EXPERIMENT") {
    setIf(out, "hypothesis", asString(payload.hypothesis));
    setIf(out, "expStatus", asString(payload.status));
    setIf(out, "signals", asStringArray(payload.experimentalEvaluationSignals));
    setIf(out, "decisionUse", asString(payload.decisionUse));
    setIf(out, "decisionModel", asStringArray(payload.decisionModel));
    setIf(out, "automaticRule", asString(payload.automaticDecisionRule));
    setIf(out, "rule", asString(payload.rule));
    return out;
  }
  if (entityType === "OBJECTIVES" || entityType === "PRINCIPLES" || entityType === "DECISION" || entityType === "LEARNING_MEMORY") {
    // Unstructured domains have no fixed schema: pass through whole (never
    // truncate). Oversize still fails closed at the budget check below.
    return { ...payload };
  }
  throw new Error(`STRATEGIC_PROJECTION_UNKNOWN_TYPE:${entityType}`);
}

/**
 * Required semantic paths per task class, checked against extracted facts
 * of INCLUDED entities only (absent domains are recorded, never invented).
 * A missing fact means the canonical schema drifted beyond what this
 * policy can safely compact -> fail closed, no provider call.
 */
const REQUIRED_SEMANTICS: Record<string, readonly string[]> = {
  research: ["STRATEGY.pillars", "STRATEGY.pilotModel", "CONSTRAINTS.rules", "EXPERIMENT.items"],
  planner: ["STRATEGY.pillars", "STRATEGY.pilotModel", "STRATEGY.platformsPrimary", "STRATEGY.format", "BRAND.namingStatus", "CONTENT_SYSTEM.learningBatchIds", "CONTENT_SYSTEM.publicationMode", "CONTENT_SYSTEM.sourcingHistorical", "CONSTRAINTS.rules", "EXPERIMENT.items"],
  writer: ["BRAND.brand", "BRAND.namingStatus", "STRATEGY.pillars", "CONTENT_SYSTEM.sourcingHistorical", "CONTENT_SYSTEM.publicationMode", "CONSTRAINTS.rules"],
  seo: ["STRATEGY.pillars", "BRAND.brand", "CONSTRAINTS.rules"],
  "visual-director": ["BRAND.brand", "CONSTRAINTS.rules"],
  ceo: ["STRATEGY.pillars", "BRAND.namingStatus", "CONTENT_SYSTEM.publicationMode", "CONSTRAINTS.rules", "EXPERIMENT.items"],
  default: ["STRATEGY.pillars", "BRAND.brand"],
};

const STRATEGIC_AUTHORITY_DOCTRINE: readonly string[] = [
  "Strategic activation changes future effective context only; never grants production/publication authority.",
  "Production/publication/public status resolve from current operational truth, never from strategy.",
];

function readPath(domains: Record<string, Record<string, unknown>>, dotted: string): unknown {
  const [type, ...rest] = dotted.split(".");
  let cur: unknown = domains[type];
  for (const k of rest) {
    const r = asRecord(cur);
    if (!r || !(k in r)) return undefined;
    cur = r[k];
  }
  return cur;
}

/**
 * Build the projected execution context for one task class. Throws
 * STRATEGIC_PROJECTION_SEMANTIC_GAP when a required fact cannot be
 * extracted, STRATEGIC_PROJECTED_CONTEXT_OVERSIZED over budget.
 */
export function buildStrategicProjection(
  entities: StrategicEntity[],
  taskClass: string,
): { context: StrategicProjectedContext; meta: StrategicProjectionMeta } {
  const policy = REQUIRED_SEMANTICS[taskClass] !== undefined ? taskClass : "default";
  const relevance = TASK_RELEVANCE[policy] ?? TASK_RELEVANCE.default;
  const domains: Record<string, Record<string, unknown>> = {};
  const missingDomains: string[] = [];
  const sourceEntities: string[] = [];
  const sourceVersions: string[] = [];
  for (const e of entities) {
    // Caller contract: canonical ACTIVE truth only. A superseded (or
    // proposed) row reaching projection is a lineage breach, never a
    // fallback — fail closed so stale truth can never win resolution.
    if (e.status !== "ACTIVE") throw new Error(`STRATEGIC_PROJECTION_NOT_ACTIVE:${e.entityId}`);
    if (!relevance.includes(e.entityType)) continue;
    const facts = extractFacts(e.entityType, e.payload);
    if (e.entityType === "EXPERIMENT" || e.entityType === "DECISION") {
      const list = (domains[e.entityType]?.items as Array<Record<string, unknown>> | undefined) ?? [];
      list.push({ entityKey: e.entityKey, version: e.version, ...facts });
      domains[e.entityType] = { items: list };
      if (e.entityType === "EXPERIMENT") {
        const item = list[list.length - 1];
        if (!Array.isArray(item.signals) || item.signals.length === 0 || typeof item.automaticRule !== "string") {
          throw new Error(`STRATEGIC_PROJECTION_SEMANTIC_GAP:${policy}:EXPERIMENT.signals`);
        }
      }
    } else {
      domains[e.entityType] = { entityKey: e.entityKey, version: e.version, ...facts };
    }
    sourceEntities.push(e.entityId);
    sourceVersions.push(`${e.entityType}/${e.entityKey}@v${e.version}`);
  }
  for (const t of relevance) {
    if (domains[t] === undefined) missingDomains.push(t);
  }
  const checked: string[] = [];
  for (const path of REQUIRED_SEMANTICS[policy] ?? []) {
    const [type] = path.split(".");
    if (domains[type] === undefined) continue;
    const value = readPath(domains, path);
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      throw new Error(`STRATEGIC_PROJECTION_SEMANTIC_GAP:${policy}:${path}`);
    }
    checked.push(path);
  }
  const contentFacts = asRecord(domains.CONTENT_SYSTEM);
  const authority: Record<string, unknown> = {
    publicationMode: (contentFacts !== null && typeof contentFacts.publicationMode === "string") ? contentFacts.publicationMode : "UNKNOWN",
    doctrine: [...STRATEGIC_AUTHORITY_DOCTRINE],
  };
  const context: StrategicProjectedContext = {
    taskClass: policy, domains, missingDomains: [...missingDomains].sort(), authority,
  };
  const bytes = Buffer.byteLength(canonicalJson(context), "utf8");
  if (bytes > STRATEGIC_PROJECTED_CONTEXT_MAX_BYTES) {
    throw new Error(`STRATEGIC_PROJECTED_CONTEXT_OVERSIZED:${policy}:${bytes}>${STRATEGIC_PROJECTED_CONTEXT_MAX_BYTES}`);
  }
  sourceEntities.sort();
  sourceVersions.sort();
  return {
    context,
    meta: {
      policyVersion: STRATEGIC_PROJECTION_POLICY_VERSION,
      taskClass: policy,
      sourceEntities,
      sourceVersions,
      byteCount: bytes,
      requiredSemanticChecks: [...checked].sort(),
      projectionHash: strategicContextHash(context),
    },
  };
}

export class StrategicStore {
  constructor(private readonly pool: pg.Pool) {}

  // -- proposals -----------------------------------------------------------

  /** Create next-version PROPOSAL (DRAFT when draft=true). Deterministic id: same coordinates+version reuses row. */
  async propose(input: {
    projectId: string; entityType: StrategicEntityType; entityKey?: string;
    payload: Record<string, unknown>; sourceArtifactIds?: string[];
    createdBy?: string; draft?: boolean;
  }): Promise<StrategicEntity> {
    if (!STRATEGIC_ENTITY_TYPES.includes(input.entityType)) throw new Error("STRATEGIC_ENTITY_TYPE_INVALID");
    const projectId = input.projectId.trim(); if (!projectId) throw new Error("STRATEGIC_PROJECT_REQUIRED");
    const key = (input.entityKey ?? "primary").trim() || "primary";
    const max = await this.pool.query(
      `SELECT COALESCE(MAX(version),0)::int AS m FROM strategic_entities WHERE project_id=$1 AND entity_type=$2 AND entity_key=$3`,
      [projectId, input.entityType, key]);
    const version = Number(max.rows[0].m) + 1;
    const entityId = `strat-${slug(projectId)}-${slug(input.entityType)}-${slug(key)}-v${version}`;
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO strategic_entities (entity_id, project_id, entity_type, entity_key, version, status, payload, schema_version, source_artifact_ids, supersedes_version, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (entity_id) DO NOTHING`,
      [entityId, projectId, input.entityType, key, version, input.draft ? "DRAFT" : "PROPOSED",
       JSON.stringify(input.payload), STRATEGIC_SCHEMA_VERSION,
       JSON.stringify(input.sourceArtifactIds ?? []), version > 1 ? version - 1 : null,
       input.createdBy ?? "owner", now]);
    const existing = await this.getEntity(entityId);
    if (!existing) throw new Error("STRATEGIC_PROPOSAL_PERSISTENCE_FAILED");
    return existing;
  }

  async getEntity(entityId: string): Promise<StrategicEntity | null> {
    const q = await this.pool.query(`SELECT * FROM strategic_entities WHERE entity_id=$1`, [entityId]);
    return q.rowCount ? rowToEntity(q.rows[0]) : null;
  }

  async history(projectId: string, entityType?: string, entityKey?: string, limit = 50): Promise<StrategicEntity[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    const cond: string[] = [`project_id=$1`]; const args: unknown[] = [projectId];
    if (entityType) { args.push(entityType); cond.push(`entity_type=$${args.length}`); }
    if (entityKey) { args.push(entityKey); cond.push(`entity_key=$${args.length}`); }
    const q = await this.pool.query(
      `SELECT * FROM strategic_entities WHERE ${cond.join(" AND ")} ORDER BY entity_type, entity_key, version DESC LIMIT ${n}`, args);
    return q.rows.map(rowToEntity);
  }

  // -- effective state ------------------------------------------------------

  /** Effective ACTIVE state + conflict detection (fail-closed signal, never auto-picks). */
  async effectiveState(projectId: string): Promise<{
    active: StrategicEntity[];
    conflicts: Array<{ entityType: string; entityKey: string; versions: number[] }>;
  }> {
    const q = await this.pool.query(
      `SELECT * FROM strategic_entities WHERE project_id=$1 AND status='ACTIVE' ORDER BY entity_type, entity_key, version DESC`, [projectId]);
    const active = q.rows.map(rowToEntity);
    const conflicts: Array<{ entityType: string; entityKey: string; versions: number[] }> = [];
    const bySlot = new Map<string, StrategicEntity[]>();
    for (const e of active) {
      const slot = `${e.entityType}::${e.entityKey}`;
      const list = bySlot.get(slot) ?? []; list.push(e); bySlot.set(slot, list);
    }
    for (const [slot, list] of bySlot) {
      const [entityType, entityKey] = slot.split("::");
      if (!MULTI_ACTIVE_TYPES.has(entityType) && list.length > 1) {
        conflicts.push({ entityType, entityKey, versions: list.map((e) => e.version) });
      }
    }
    return { active, conflicts };
  }

  /** Deterministic readiness: READY | INCOMPLETE | CONFLICTED | NOT_CONFIGURED. */
  async strategicHealth(projectId: string): Promise<{ status: "READY" | "INCOMPLETE" | "CONFLICTED" | "NOT_CONFIGURED"; detail: string }> {
    const { active, conflicts } = await this.effectiveState(projectId);
    if (active.length === 0) return { status: "NOT_CONFIGURED", detail: "STRATEGY_NOT_CONFIGURED" };
    if (conflicts.length > 0) return { status: "CONFLICTED", detail: "STRATEGIC_STATE_CONFLICT" };
    const types = new Set(active.map((e) => e.entityType));
    if (types.has("STRATEGY") && types.has("BRAND") && types.has("CONTENT_SYSTEM")) {
      return { status: "READY", detail: "strategy+brand+content-system active" };
    }
    return { status: "INCOMPLETE", detail: `active: ${[...types].sort().join(",")}` };
  }

  // -- activation (governed) --------------------------------------------------

  /**
   * Activate a PROPOSED/DRAFT entity under exact Owner authority.
   * Fail-closed: approval must be DECIDED APPROVE, scope STRATEGY_ACTIVATION
   * (or per-type), target_id == entity_id, same project. Idempotent on repeat.
   */
  async activate(input: { entityId: string; approvalId: string; activatedBy?: string }): Promise<{ entity: StrategicEntity; activation: StrategicActivation; created: boolean }> {
    const entity = await this.getEntity(input.entityId);
    if (!entity) throw new Error("STRATEGIC_ENTITY_NOT_FOUND");
    if (entity.status === "ACTIVE") {
      const prior = await this.pool.query(`SELECT * FROM strategic_activations WHERE entity_id=$1 AND approval_id=$2`, [entity.entityId, input.approvalId]);
      if (prior.rowCount) {
        return { entity, activation: this.toActivation(prior.rows[0]), created: false };
      }
      throw new Error("STRATEGIC_ALREADY_ACTIVE:DIFFERENT_APPROVAL");
    }
    if (entity.status !== "PROPOSED" && entity.status !== "DRAFT") {
      throw new Error(`STRATEGIC_STATUS_NOT_ACTIVATABLE:${entity.status}`);
    }
    const ap = await this.pool.query(`SELECT * FROM control_approvals WHERE approval_id=$1`, [input.approvalId]);
    if (!ap.rowCount) throw new Error("STRATEGIC_APPROVAL_NOT_FOUND");
    const a = ap.rows[0];
    if (a.status === "DECIDED" && a.owner_decision !== "APPROVE") throw new Error(`STRATEGIC_APPROVAL_NOT_APPROVED:${a.owner_decision ?? a.status}`);
    if (a.status !== "DECIDED") throw new Error("STRATEGIC_APPROVAL_PENDING");
    const scope = String(a.target_type);
    const allowed = new Set(["STRATEGY_ACTIVATION", `${entity.entityType}_ACTIVATION`]);
    if (!allowed.has(scope)) throw new Error(`STRATEGIC_APPROVAL_SCOPE_MISMATCH:${scope}`);
    if (String(a.target_id) !== entity.entityId) throw new Error("STRATEGIC_APPROVAL_TARGET_MISMATCH");
    if (String(a.project_id) !== entity.projectId) throw new Error("STRATEGIC_APPROVAL_PROJECT_MISMATCH");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(`SELECT version FROM strategic_entities WHERE project_id=$1 AND entity_type=$2 AND entity_key=$3 AND status='ACTIVE' ORDER BY version DESC`, [entity.projectId, entity.entityType, entity.entityKey]);
      const singleton = !MULTI_ACTIVE_TYPES.has(entity.entityType);
      let previousActiveVersion: number | null = null;
      if (singleton && existing.rowCount) {
        previousActiveVersion = Number(existing.rows[0].version);
        await client.query(`UPDATE strategic_entities SET status='SUPERSEDED' WHERE project_id=$1 AND entity_type=$2 AND entity_key=$3 AND status='ACTIVE'`, [entity.projectId, entity.entityType, entity.entityKey]);
      }
      const now = new Date().toISOString();
      await client.query(`UPDATE strategic_entities SET status='ACTIVE', activated_at=$2, activated_by_approval_id=$3 WHERE entity_id=$1`, [entity.entityId, now, input.approvalId]);
      const activationId = `sact-${entity.entityId}-v${entity.version}`;
      await client.query(
        `INSERT INTO strategic_activations (activation_id, entity_id, project_id, entity_type, entity_key, version, approval_id, activated_by, activated_at, previous_active_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (activation_id) DO NOTHING`,
        [activationId, entity.entityId, entity.projectId, entity.entityType, entity.entityKey, entity.version, input.approvalId, input.activatedBy ?? "owner", now, previousActiveVersion]);
      await client.query("COMMIT");
      const done = await this.getEntity(entity.entityId);
      const actRow = await this.pool.query(`SELECT * FROM strategic_activations WHERE activation_id=$1`, [activationId]);
      return { entity: done!, activation: this.toActivation(actRow.rows[0]), created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private toActivation(r: Record<string, unknown>): StrategicActivation {
    return {
      activationId: String(r.activation_id), entityId: String(r.entity_id), projectId: String(r.project_id),
      entityType: String(r.entity_type) as StrategicEntityType, entityKey: String(r.entity_key),
      version: Number(r.version), approvalId: String(r.approval_id),
      activatedBy: String(r.activated_by), activatedAt: String(r.activated_at),
      previousActiveVersion: r.previous_active_version === null || r.previous_active_version === undefined ? null : Number(r.previous_active_version),
    };
  }

  async activations(entityId: string): Promise<StrategicActivation[]> {
    const q = await this.pool.query(`SELECT * FROM strategic_activations WHERE entity_id=$1 ORDER BY activated_at DESC`, [entityId]);
    return q.rows.map((r) => this.toActivation(r));
  }

  // -- request-iteration continuation ------------------------------------------

  /**
   * Governed revision after an Owner REQUEST_ITERATION decision.
   *
   * General mechanism (never Morroway/Constraints-specific): a DECIDED
   * REQUEST_ITERATION decision on the exact prior entity authorizes ONE
   * revised PROPOSED next version carrying revisedPayload. Fail-closed:
   * unknown entities/decisions, non-iteration decisions, target or project
   * mismatch, non-revisable source status, and occupied version slots all
   * reject. Grants ZERO activation/approval/production/publication
   * authority — the revision still needs a fresh scoped Owner decision plus
   * activation. Idempotent: repeating identical inputs returns the existing
   * version instead of duplicating it. Prior rows are never touched.
   */
  async iterate(input: {
    priorEntityId: string; sourceDecisionId: string;
    revisedPayload: Record<string, unknown>; sourceArtifactIds?: string[];
    createdBy?: string;
  }): Promise<{ entity: StrategicEntity; iteration: StrategicIteration; created: boolean }> {
    if (input.revisedPayload === null || typeof input.revisedPayload !== "object" || Array.isArray(input.revisedPayload)) {
      throw new Error("STRATEGIC_ITERATION_PAYLOAD_INVALID");
    }
    const prior = await this.getEntity(input.priorEntityId);
    if (!prior) throw new Error("STRATEGIC_ENTITY_NOT_FOUND");
    if (prior.status !== "PROPOSED" && prior.status !== "DRAFT") {
      throw new Error(`STRATEGIC_ITERATION_SOURCE_NOT_REVISABLE:${prior.status}`);
    }
    const dq = await this.pool.query(`SELECT * FROM control_approvals WHERE approval_id=$1`, [input.sourceDecisionId]);
    if (!dq.rowCount) throw new Error("STRATEGIC_ITERATION_DECISION_NOT_FOUND");
    const d = dq.rows[0] as Record<string, unknown>;
    if (String(d.project_id) !== prior.projectId) throw new Error("STRATEGIC_ITERATION_PROJECT_MISMATCH");
    if (String(d.target_id) !== prior.entityId) throw new Error("STRATEGIC_ITERATION_TARGET_MISMATCH");
    if (String(d.status) !== "DECIDED") throw new Error("STRATEGIC_ITERATION_DECISION_PENDING");
    if (String(d.owner_decision) !== "REQUEST_ITERATION") {
      throw new Error(`STRATEGIC_ITERATION_DECISION_NOT_ITERATION:${String(d.owner_decision ?? d.status)}`);
    }
    const rationale = d.owner_rationale === null || d.owner_rationale === undefined ? "" : String(d.owner_rationale);
    const newVersion = prior.version + 1;
    const newEntityId = `strat-${slug(prior.projectId)}-${slug(prior.entityType)}-${slug(prior.entityKey)}-v${newVersion}`;
    const iterationId = `siter-${newEntityId}`;
    const existing = await this.getEntity(newEntityId);
    if (existing) {
      if (canonicalJson(existing.payload) !== canonicalJson(input.revisedPayload)) {
        throw new Error(`STRATEGIC_ITERATION_VERSION_CONFLICT:v${newVersion}`);
      }
      await this.pool.query(
        `INSERT INTO strategic_iterations (iteration_id, project_id, entity_type, entity_key, prior_version, new_entity_id, new_version, source_decision_id, owner_rationale, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (iteration_id) DO NOTHING`,
        [iterationId, prior.projectId, prior.entityType, prior.entityKey, prior.version,
          newEntityId, newVersion, input.sourceDecisionId, rationale, input.createdBy ?? "owner", new Date().toISOString()]);
      return { entity: existing, iteration: (await this.getIterationByNewEntity(newEntityId))!, created: false };
    }
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO strategic_entities (entity_id, project_id, entity_type, entity_key, version, status, payload, schema_version, source_artifact_ids, supersedes_version, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,'PROPOSED',$6,$7,$8,$9,$10,$11) ON CONFLICT (entity_id) DO NOTHING`,
      [newEntityId, prior.projectId, prior.entityType, prior.entityKey, newVersion,
        JSON.stringify(input.revisedPayload), STRATEGIC_SCHEMA_VERSION,
        JSON.stringify(input.sourceArtifactIds ?? prior.sourceArtifactIds),
        prior.version, input.createdBy ?? "owner", now]);
    const entity = await this.getEntity(newEntityId);
    if (!entity) throw new Error("STRATEGIC_ITERATION_PERSISTENCE_FAILED");
    if (canonicalJson(entity.payload) !== canonicalJson(input.revisedPayload)) {
      throw new Error(`STRATEGIC_ITERATION_VERSION_CONFLICT:v${newVersion}`);
    }
    await this.pool.query(
      `INSERT INTO strategic_iterations (iteration_id, project_id, entity_type, entity_key, prior_version, new_entity_id, new_version, source_decision_id, owner_rationale, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (iteration_id) DO NOTHING`,
      [iterationId, prior.projectId, prior.entityType, prior.entityKey, prior.version,
        newEntityId, newVersion, input.sourceDecisionId, rationale, input.createdBy ?? "owner", now]);
    return { entity, iteration: (await this.getIterationByNewEntity(newEntityId))!, created: true };
  }

  /** Iteration provenance for a revised entity (null when not iteration-born). */
  async getIterationByNewEntity(newEntityId: string): Promise<StrategicIteration | null> {
    const q = await this.pool.query(`SELECT * FROM strategic_iterations WHERE new_entity_id=$1`, [newEntityId]);
    if (!q.rowCount) return null;
    const r = q.rows[0] as Record<string, unknown>;
    return {
      iterationId: String(r.iteration_id), projectId: String(r.project_id),
      entityType: String(r.entity_type) as StrategicEntityType, entityKey: String(r.entity_key),
      priorVersion: Number(r.prior_version), newEntityId: String(r.new_entity_id),
      newVersion: Number(r.new_version), sourceDecisionId: String(r.source_decision_id),
      ownerRationale: String(r.owner_rationale), createdBy: String(r.created_by),
      createdAt: String(r.created_at),
    };
  }

  // -- resolver ---------------------------------------------------------------

  /** Deterministic effective-context resolution (side-effect-free, no snapshot write). */
  async resolve(input: { projectId: string; agentId?: string; taskClass?: string }): Promise<{
    projectId: string; taskClass: string; entityRefs: StrategicSnapshot["entityRefs"];
    context: Record<string, unknown>; contextHash: string; resolverVersion: string;
    includedTypes: string[]; excludedTypes: string[]; conflicts: Array<{ entityType: string; entityKey: string; versions: number[] }>;
    projectedContext: StrategicProjectedContext; projection: StrategicProjectionMeta;
    status: string;
  }> {
    const taskClass = input.taskClass ?? taskClassForAgent(input.agentId);
    const relevance = TASK_RELEVANCE[taskClass] ?? TASK_RELEVANCE.default;
    const { active, conflicts } = await this.effectiveState(input.projectId);
    const singletonConflict = conflicts.length > 0;
    if (singletonConflict) throw new Error("STRATEGIC_STATE_CONFLICT");
    const included = active.filter((e) => relevance.includes(e.entityType));
    const includedTypes = [...new Set(included.map((e) => e.entityType))].sort();
    const excludedTypes = STRATEGIC_ENTITY_TYPES.filter((t) => !relevance.includes(t));
    const entityRefs = included.map((e) => ({ entityId: e.entityId, entityType: e.entityType, entityKey: e.entityKey, version: e.version }))
      .sort((a, b) => (a.entityType < b.entityType ? -1 : 1));
    const context: Record<string, unknown> = {};
    for (const e of included) {
      // Slice 6: shaped entity carries its own governance metadata so agents
      // and UI can distinguish APPROVED fact / EXPERIMENTAL hypothesis /
      // PROPOSED draft without reparsing history. Payload stays untouched.
      context[e.entityType] = {
        key: e.entityKey, version: e.version, entityId: e.entityId,
        status: e.status, lifecycle: e.status,
        authority: { activatedByApprovalId: e.activatedByApprovalId, activatedAt: e.activatedAt },
        evidenceRefs: e.sourceArtifactIds, supersedesVersion: e.supersedesVersion,
        payload: e.payload,
      };
    }
    const shaped = { projectId: input.projectId, taskClass, entities: context };
    // Budget remediation: the canonical shaped blob is the auditable source,
    // never the injected execution context — no byte cap applies to it.
    // The 8000B fail-closed budget is enforced on the task projection below
    // (same number, enforced where model tokens are actually spent).
    const contextHash = strategicContextHash(shaped);
    const projected = buildStrategicProjection(included, taskClass);
    return {
      projectId: input.projectId, taskClass, entityRefs, context: shaped, contextHash,
      resolverVersion: STRATEGIC_RESOLVER_VERSION, includedTypes, excludedTypes,
      projectedContext: projected.context, projection: projected.meta,
      conflicts, status: included.length === 0 ? "STRATEGY_NOT_CONFIGURED" : "RESOLVED",
    };
  }

  /** Freeze an immutable snapshot of a resolution (execution boundary only). Idempotent by hash. */
  async snapshotResolved(resolved: { projectId: string; taskClass: string; entityRefs: StrategicSnapshot["entityRefs"]; context: Record<string, unknown>; contextHash: string; projection?: StrategicProjectionMeta }, agentId?: string): Promise<StrategicSnapshot> {
    const snapshotId = `snap-${resolved.contextHash.slice(0, 16)}-${slug(resolved.taskClass)}`;
    const now = new Date().toISOString();
    // Projection metadata rides along for auditability WITHOUT entering the
    // hash (hash covers canonical truth only; historical rows without the
    // key keep reading fine).
    const stored = resolved.projection !== undefined && resolved.projection !== null
      ? { ...resolved.context, _projection: resolved.projection }
      : resolved.context;
    await this.pool.query(
      `INSERT INTO strategic_context_snapshots (snapshot_id, project_id, task_class, agent_id, entity_refs, context, context_hash, resolver_version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (snapshot_id) DO NOTHING`,
      [snapshotId, resolved.projectId, resolved.taskClass, agentId ?? null,
        JSON.stringify(resolved.entityRefs), JSON.stringify(stored),
        resolved.contextHash, STRATEGIC_RESOLVER_VERSION, now]);
    return (await this.getSnapshot(snapshotId))!;
  }

  async getSnapshot(snapshotId: string): Promise<StrategicSnapshot | null> {
    const q = await this.pool.query(`SELECT * FROM strategic_context_snapshots WHERE snapshot_id=$1`, [snapshotId]);
    if (!q.rowCount) return null;
    const r = q.rows[0];
    const parse = (v: unknown): unknown => (typeof v === "string" ? JSON.parse(v) : v);
    return {
      snapshotId: String(r.snapshot_id), projectId: String(r.project_id), taskClass: String(r.task_class),
      agentId: r.agent_id === null || r.agent_id === undefined ? null : String(r.agent_id),
      entityRefs: parse(r.entity_refs) as StrategicSnapshot["entityRefs"],
      context: parse(r.context) as Record<string, unknown>,
      contextHash: String(r.context_hash), resolverVersion: String(r.resolver_version),
      createdAt: String(r.created_at),
    };
  }

  /**
   * Strategic lineage for an artifact: executions whose artifact list contains
   * it (JSONB containment) -> their snapshots. Bounded; newest executions first.
   */
  async artifactLineage(artifactId: string): Promise<{ artifactId: string; executions: Array<{ executionId: string; agentId: string; snapshotId: string | null }>; snapshots: Array<{ executionId: string; snapshot: StrategicSnapshot }> }> {
    const q = await this.pool.query(
      `SELECT execution_id, agent_id, strategic_snapshot_id FROM execution_provenance WHERE artifact_ids ? $1 ORDER BY started_at DESC LIMIT 20`,
      [artifactId]);
    const executions = q.rows.map((r: Record<string, unknown>) => ({
      executionId: String(r.execution_id), agentId: String(r.agent_id),
      snapshotId: r.strategic_snapshot_id === null || r.strategic_snapshot_id === undefined ? null : String(r.strategic_snapshot_id),
    }));
    const snapshots: Array<{ executionId: string; snapshot: StrategicSnapshot }> = [];
    for (const e of executions) {
      if (e.snapshotId) {
        const snapshot = await this.getSnapshot(e.snapshotId);
        if (snapshot) snapshots.push({ executionId: e.executionId, snapshot });
      }
    }
    return { artifactId, executions, snapshots };
  }

  /** Strategic lineage for an execution: provenance -> snapshot -> entity refs. */
  async lineageForExecution(executionId: string): Promise<{ executionId: string; snapshot: StrategicSnapshot | null }> {
    const q = await this.pool.query(`SELECT strategic_snapshot_id FROM execution_provenance WHERE execution_id=$1`, [executionId]);
    const sid = q.rows[0]?.strategic_snapshot_id;
    if (!sid) return { executionId, snapshot: null };
    return { executionId, snapshot: await this.getSnapshot(String(sid)) };
  }

  /**
   * Review bundle for one entity: exact immutable record + comparable ACTIVE
   * baseline (same project/type/key, highest version) + deterministic diff.
   * Read-only: zero mutation, zero execution, zero provider use.
   */
  async reviewEntity(projectId: string, entityId: string): Promise<{
    entity: StrategicEntity;
    baseline: StrategicEntity | null;
    baselineConflict: boolean;
    diff: { baseline: "COMPARABLE" | "NONE"; rows: StrategicDiffRow[]; truncated: boolean };
  }> {
    const entity = await this.getEntity(entityId);
    if (!entity || entity.projectId !== projectId) throw new Error("STRATEGIC_ENTITY_NOT_FOUND");
    const base = await this.pool.query(
      `SELECT * FROM strategic_entities WHERE project_id=$1 AND entity_type=$2 AND entity_key=$3 AND status='ACTIVE' ORDER BY version DESC`,
      [projectId, entity.entityType, entity.entityKey]);
    const baselines = base.rows.map(rowToEntity);
    const baseline = baselines.length === 0 ? null : baselines[0];
    const diff = strategicDiff(baseline?.payload ?? null, entity.payload);
    return { entity, baseline, baselineConflict: baselines.length > 1, diff };
  }

  taskClassForAgent(agentId: string | null | undefined): string {
    return taskClassForAgent(agentId);
  }
}

export const STRATEGIC_RELEVANCE = TASK_RELEVANCE;

// -- deterministic review diff --------------------------------------------------

export type StrategicDiffState = "UNCHANGED" | "ADDED" | "REMOVED" | "CHANGED";
export interface StrategicDiffRow {
  path: string; state: StrategicDiffState; current: unknown; proposed: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function flattenPayload(value: unknown, prefix: string, into: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    if (value.length === 0) { into.set(prefix || "(root)", []); return; }
    value.forEach((item, i) => flattenPayload(item, `${prefix}[${i}]`, into));
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) { into.set(prefix || "(root)", {}); return; }
    for (const key of keys) flattenPayload(value[key], prefix ? `${prefix}.${key}` : key, into);
    return;
  }
  into.set(prefix || "(root)", value ?? null);
}

/**
 * Deterministic field-level diff of two payloads. No LLM, no semantics —
 * structural comparison only. Row-capped deterministically (sorted by path).
 */
export function strategicDiff(
  current: Record<string, unknown> | null,
  proposed: Record<string, unknown>,
  maxRows = 200,
): { baseline: "COMPARABLE" | "NONE"; rows: StrategicDiffRow[]; truncated: boolean } {
  if (current === null) {
    const flat = new Map<string, unknown>();
    flattenPayload(proposed, "", flat);
    const rows = [...flat.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, maxRows)
      .map(([path, proposedValue]) => ({ path, state: "ADDED" as StrategicDiffState, current: null, proposed: proposedValue }));
    return { baseline: "NONE", rows, truncated: flat.size > maxRows };
  }
  const a = new Map<string, unknown>(); flattenPayload(current, "", a);
  const b = new Map<string, unknown>(); flattenPayload(proposed, "", b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const rows: StrategicDiffRow[] = [];
  for (const path of paths) {
    const hasA = a.has(path); const hasB = b.has(path);
    if (hasA && !hasB) rows.push({ path, state: "REMOVED", current: a.get(path), proposed: null });
    else if (!hasA && hasB) rows.push({ path, state: "ADDED", current: null, proposed: b.get(path) });
    else if (canonicalJson(a.get(path)) !== canonicalJson(b.get(path))) rows.push({ path, state: "CHANGED", current: a.get(path), proposed: b.get(path) });
    else rows.push({ path, state: "UNCHANGED", current: a.get(path), proposed: b.get(path) });
  }
  return { baseline: "COMPARABLE", rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}
