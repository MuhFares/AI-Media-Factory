import type pg from "pg";
import { evaluateLlmPreflight, type CanonicalRouteResolution, type LlmPreflightRequest, type ModelCatalogEvidence } from "./routing-preflight.js";

export type RoutingSlot = "primary" | "fallback" | "economy" | "premiumEscalation";

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export class ProductionModelRoutingStore {
  constructor(private readonly pool: pg.Pool) {}

  async activate(input: any) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE production_model_routing_versions SET active=FALSE,deactivated_at=$3 WHERE scope_type=$1 AND COALESCE(project_id,'')=COALESCE($2,'') AND active`, [input.scopeType, input.projectId ?? null, new Date().toISOString()]);
      await client.query(`INSERT INTO production_model_routing_versions(routing_version_id,profile,scope_type,project_id,benchmark_run_id,dataset_version,decision_source,owner_decision,active,activated_at,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10)`, [input.versionId, input.profile, input.scopeType, input.projectId ?? null, input.benchmarkRunId, input.datasetVersion, "BENCHMARK_EVIDENCE", "APPROVED", new Date().toISOString(), JSON.stringify(input.provenance ?? {})]);
      for (const entry of input.entries) await client.query(`INSERT INTO production_model_routing_entries(routing_version_id,role,primary_model_id,fallback_model_id,economy_model_id,premium_escalation_model_id,price_snapshot_ids,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [input.versionId, entry.role, entry.primary ?? null, entry.fallback ?? null, entry.economy ?? null, entry.premiumEscalation ?? null, JSON.stringify(entry.priceSnapshots ?? {}), JSON.stringify(entry.evidence ?? {})]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  /** Exact active scope lookup. Project routing never silently inherits GLOBAL_DEFAULT. */
  async active(scopeType: "GLOBAL_DEFAULT" | "PROJECT" = "GLOBAL_DEFAULT", projectId?: string) {
    if (scopeType === "PROJECT" && !projectId) throw new Error("PROJECT_ROUTING_ID_REQUIRED");
    const query = await this.pool.query(
      `SELECT v.*,jsonb_agg(jsonb_build_object('role',e.role,'primary',e.primary_model_id,'fallback',e.fallback_model_id,'economy',e.economy_model_id,'premiumEscalation',e.premium_escalation_model_id,'priceSnapshots',e.price_snapshot_ids,'evidence',e.evidence) ORDER BY e.role) entries
       FROM production_model_routing_versions v JOIN production_model_routing_entries e ON e.routing_version_id=v.routing_version_id
       WHERE v.active AND v.scope_type=$1 AND (($1='PROJECT' AND v.project_id=$2) OR ($1='GLOBAL_DEFAULT' AND v.project_id IS NULL))
       GROUP BY v.routing_version_id LIMIT 1`,
      [scopeType, projectId ?? null],
    );
    return query.rows[0] ?? null;
  }

  async resolve(role: string, options: { projectId?: string; slot?: RoutingSlot; premiumAuthorized?: boolean; fallbackAuthorized?: boolean; fallbackReason?: string } = {}): Promise<CanonicalRouteResolution> {
    const routingScope = options.projectId ? "PROJECT" : "GLOBAL_DEFAULT";
    const routing = await this.active(routingScope, options.projectId);
    if (!routing) throw new Error("NO_ACTIVE_ROUTING");
    const entry = (routing.entries as any[]).find((item) => item.role === role);
    if (!entry) throw new Error("ROLE_NOT_MODEL_ROUTED");
    const slot = options.slot ?? "primary";
    if (slot === "premiumEscalation" && !options.premiumAuthorized) throw new Error("PREMIUM_ESCALATION_NOT_AUTHORIZED");
    if (slot === "fallback") {
      const policy = record(record(entry.evidence).fallbackPolicy);
      if (options.fallbackAuthorized !== true || policy.enabled !== true) throw new Error("FALLBACK_NOT_AUTHORIZED");
      if (!options.fallbackReason?.trim()) throw new Error("FALLBACK_REASON_REQUIRED");
    }
    const model = entry[slot];
    if (!model) throw new Error(`APPROVED_${slot.toUpperCase()}_ROUTE_UNAVAILABLE`);
    const priceSnapshotId = record(entry.priceSnapshots)[model];
    if (typeof priceSnapshotId !== "string" || !priceSnapshotId) throw new Error("PRICE_SNAPSHOT_UNAVAILABLE");
    return {
      routingVersionId: String(routing.routing_version_id), routingScope, projectId: options.projectId ?? null,
      profile: String(routing.profile), role, slot, provider: "openrouter", requestedModel: String(model),
      resolvedModel: String(model), model: String(model), priceSnapshotId,
      fallbackUsed: slot === "fallback", fallbackReason: slot === "fallback" ? options.fallbackReason!.trim() : null,
    };
  }

  /**
   * Materialize the active PROJECT routing table for workflow/Command Room
   * context.  This is compatibility data only: every transport still calls
   * `preflight`, which re-resolves the authoritative row and detects drift.
   * A branded project never receives a GLOBAL or ambient-environment route.
   */
  async configurationMap(projectId: string): Promise<Record<string, {
    provider: "openrouter"; model: string; source: "PROJECT";
    routingVersionId: string; routingScope: "PROJECT"; priceSnapshotId: string;
  }>> {
    const routing = await this.active("PROJECT", projectId);
    if (!routing) throw new Error("NO_ACTIVE_ROUTING");
    const output: Record<string, {
      provider: "openrouter"; model: string; source: "PROJECT";
      routingVersionId: string; routingScope: "PROJECT"; priceSnapshotId: string;
    }> = {};
    for (const entry of routing.entries as any[]) {
      if (typeof entry.role !== "string" || typeof entry.primary !== "string" || !entry.primary) continue;
      const priceSnapshotId = record(entry.priceSnapshots)[entry.primary];
      if (typeof priceSnapshotId !== "string" || !priceSnapshotId) throw new Error(`PRICE_SNAPSHOT_UNAVAILABLE:${entry.role}`);
      output[entry.role] = {
        provider: "openrouter", model: entry.primary, source: "PROJECT",
        routingVersionId: String(routing.routing_version_id), routingScope: "PROJECT", priceSnapshotId,
      };
    }
    return output;
  }

  async preflight(role: string, options: {
    projectId?: string; slot?: RoutingSlot; premiumAuthorized?: boolean; fallbackAuthorized?: boolean; fallbackReason?: string;
    requirements: LlmPreflightRequest; expectedRoutingVersionId?: string; expectedModel?: string;
  }) {
    const route = await this.resolve(role, options);
    if (options.expectedRoutingVersionId && route.routingVersionId !== options.expectedRoutingVersionId) throw new Error("ROUTING_VERSION_DRIFT");
    if (options.expectedModel && route.resolvedModel !== options.expectedModel) throw new Error("ROUTING_MODEL_DRIFT");
    const query = await this.pool.query(
      `SELECT c.provider,c.provider_model_id,c.availability,c.retrieved_at,c.context_length,c.input_modalities,c.output_modalities,
              c.supported_parameters,c.capabilities,c.current_price_snapshot_id,c.capability_hash,c.raw_metadata,
              p.retrieved_at AS price_snapshot_retrieved_at
       FROM provider_model_catalog c
       LEFT JOIN provider_model_price_snapshots p ON p.price_snapshot_id=c.current_price_snapshot_id
       WHERE c.provider=$1 AND c.provider_model_id=$2`,
      [route.provider, route.resolvedModel],
    );
    if (!query.rowCount) throw new Error("MODEL_CATALOG_ENTRY_MISSING");
    const row = query.rows[0]; const raw = record(row.raw_metadata); const top = record(raw.top_provider);
    const maxOutput = Number(top.max_completion_tokens ?? raw.max_completion_tokens);
    const catalog: ModelCatalogEvidence = {
      provider: String(row.provider), model: String(row.provider_model_id), availability: String(row.availability),
      retrievedAt: typeof row.retrieved_at === "string" ? row.retrieved_at : null,
      contextLength: typeof row.context_length === "number" ? row.context_length : row.context_length === null ? null : Number(row.context_length),
      maxOutputTokens: Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : null,
      inputModalities: strings(row.input_modalities), outputModalities: strings(row.output_modalities),
      supportedParameters: strings(row.supported_parameters), capabilities: record(row.capabilities),
      currentPriceSnapshotId: typeof row.current_price_snapshot_id === "string" ? row.current_price_snapshot_id : null,
      priceSnapshotRetrievedAt: typeof row.price_snapshot_retrieved_at === "string" ? row.price_snapshot_retrieved_at : null,
      capabilityHash: typeof row.capability_hash === "string" ? row.capability_hash : null,
      protocol: "OPENAI_COMPATIBLE",
    };
    const result = evaluateLlmPreflight(route, catalog, options.requirements);
    if (!result.ok) throw new Error(`LLM_PREFLIGHT_FAILED:${result.code}`);
    return result;
  }
}
