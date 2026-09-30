import type { Json } from "@ai-media-factory/shared";
import type { StrategicStore } from "@ai-media-factory/database";
import type { ApprovalActionabilityState } from "@ai-media-factory/database";
import type { CanonicalLifecycle } from "@ai-media-factory/database";

/** Compact, approved context; never sends an opaque artifact id as the only grounding. */
export function resolveApprovedProjectContext(projectId: string, requested: unknown): Record<string, Json> {
  const rawRefs = requested !== null && typeof requested === "object" ? (requested as Record<string, unknown>).artifactRefs : undefined;
  const refs = Array.isArray(rawRefs) ? rawRefs.filter((v): v is string => typeof v === "string") : [];
  if (projectId.toLowerCase() !== "morroway") return { projectId, resolvedArtifactRefs: refs };
  return {
    projectId: "morroway", brand: "Morroway", projectPurpose: "consumer media and storytelling brand", operatingParent: "AI Media Factory / AMF (corporate and operating parent; not the consumer brand)",
    contentPillars: ["REAL-WORLD HISTORICAL POV / source-supported historical perspective storytelling", "ORIGINAL AI-GENERATED FANTASY / emotional imaginative storytelling"],
    historicalPovRule: "For a Historical POV request, use real historical people, civilizations, documented events, or source-supported settings. Never substitute fantasy.",
    pilotState: "approved audience-facing consumer master brand; Naming V1 is closed; adaptive pilot is in planning; no claim of an existing franchise, game, or fictional universe",
    positioning: "Use Morroway as the audience-facing storytelling brand; AMF is the operating parent.",
    prohibitions: ["Morroway is not Morrowind", "Morroway is not Elder Scrolls", "Do not treat Morroway as a game, game franchise, gameplay setting, or existing fictional universe", "Do not use invented lore for a Historical POV request"],
    resolvedArtifactRefs: refs.includes("art-brand-architecture-v1") ? ["art-brand-architecture-v1: approved brand architecture; AMF is operating parent and Morroway is the approved audience-facing consumer master brand; Naming V1 is closed"] : refs,
  };
}

/**
 * Strategic Operating Layer V1 — governed context resolution.
 *
 * When first-class strategic entities are ACTIVE for the project, the context
 * is built from them (entity payload fields overlay the legacy defaults) and
 * frozen into an immutable snapshot; the injected context carries a compact
 * `_strategic` trace (snapshot id, versions, hash). With no configured
 * strategy the legacy approved context is returned untouched (snapshot null).
 * Singleton conflicts and oversize contexts fail closed (rethrow).
 */
export async function resolveStrategicProjectContext(
  strategic: StrategicStore,
  projectId: string,
  requested: unknown,
  agentId?: string,
  operational?: Record<string, Json> | null,
): Promise<{ context: Record<string, Json>; snapshotId: string | null }> {
  const legacy = resolveApprovedProjectContext(projectId, requested);
  let resolved;
  try {
    resolved = await strategic.resolve({ projectId, agentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // No configured strategy (or DB unavailable) -> legacy path. Conflict,
    // oversize, semantic-gap, and unknown-type failures are governance
    // failures and must NOT degrade silently (legacy fallback would
    // reintroduce unlabeled prose and hide the breach).
    if (/STRATEGIC_STATE_CONFLICT|STRATEGIC_CONTEXT_OVERSIZED|STRATEGIC_PROJECTED_CONTEXT_OVERSIZED|STRATEGIC_PROJECTION_SEMANTIC_GAP|STRATEGIC_PROJECTION_UNKNOWN_TYPE/.test(message)) throw error;
    if (operational !== null && operational !== undefined) legacy._operational = operational;
    return { context: legacy, snapshotId: null };
  }
  if (resolved.status === "STRATEGY_NOT_CONFIGURED") {
    if (operational !== null && operational !== undefined) legacy._operational = operational;
    return { context: legacy, snapshotId: null };
  }
  const snapshot = await strategic.snapshotResolved(resolved, agentId ?? undefined);
  const overlaid: Record<string, Json> = { ...legacy };
  const entities = resolved.context.entities as Record<string, {
    key?: unknown; version?: unknown; entityId?: unknown; status?: unknown;
    authority?: unknown; evidenceRefs?: unknown; supersedesVersion?: unknown;
    payload?: Record<string, unknown>;
  }>;
  // Budget remediation: inject the task-projected facts (budget-validated),
  // never full canonical payloads. Bare top-level keys preserved for
  // compatibility; on the rare cross-domain key collision the winner is
  // deterministic (entityRefs sort by entityType, later overwrite earlier).
  const projected = (resolved.projectedContext ?? {}) as {
    taskClass?: unknown; domains?: Record<string, Record<string, unknown>>;
  };
  const projectedDomains = projected.domains !== null && typeof projected.domains === "object" && !Array.isArray(projected.domains)
    ? projected.domains
    : {};
  for (const facts of Object.values(projectedDomains)) {
    if (facts !== null && typeof facts === "object" && !Array.isArray(facts)) {
      for (const [key, value] of Object.entries(facts)) {
        if (value !== undefined) overlaid[key] = value as Json;
      }
    }
  }
  // Slice 6: explicit structured current-truth index. Flat payload overlay
  // above is preserved for compatibility; _strategicCurrent tells agents,
  // per domain, WHAT is current (status/version), WHO authorized it
  // (approval), WHAT proves it (evidence refs), and that referenced
  // artifact prose may be stale (current truth wins on conflict).
  const current: Record<string, Json> = {};
  for (const ref of resolved.entityRefs) {
    const slot = entities[ref.entityType] ?? {};
    current[ref.entityType] = {
      entityKey: ref.entityKey, version: ref.version,
      status: typeof slot.status === "string" ? slot.status : "ACTIVE",
      authority: (slot.authority ?? { activatedByApprovalId: null, activatedAt: null }) as Json,
      evidenceRefs: (Array.isArray(slot.evidenceRefs) ? slot.evidenceRefs : []) as Json,
      supersedesVersion: (typeof slot.supersedesVersion === "number" ? slot.supersedesVersion : null) as Json,
    } as Json;
  }
  const versions: Record<string, string> = {};
  for (const ref of resolved.entityRefs) versions[ref.entityType] = `${ref.entityKey}@v${ref.version}`;
  overlaid._strategic = {
    snapshotId: snapshot.snapshotId, taskClass: resolved.taskClass,
    resolverVersion: resolved.resolverVersion, contextHash: resolved.contextHash,
    versions, includedTypes: resolved.includedTypes,
  } as unknown as Json;
  overlaid._strategicCurrent = {
    domains: current,
    note: "ACTIVE entities are current truth. Referenced artifact text may be stale; current truth wins on conflict. _operational wins on actionability.",
  } as unknown as Json;
  if (resolved.projection !== undefined && resolved.projection !== null) {
    overlaid._strategicProjection = resolved.projection as unknown as Json;
  }
  if (operational !== null && operational !== undefined) {
    overlaid._operational = operational;
  }
  return { context: overlaid, snapshotId: snapshot.snapshotId };
}

/**
 * Slice 5 remediation — operational evidence for project-analysis prompts.
 *
 * The failed Owner ASK ("analyze Morroway project state") reached the model
 * with only static brand/strategy text: no lifecycle state, no approvals,
 * no artifacts, no recent work. A bigger token budget cannot fix missing
 * evidence. This builder assembles a compact, deterministic operational
 * snapshot from canonical read models (lifecycle + approval actionability),
 * so reasoning operates on live platform truth instead of parametric memory.
 * Bounded (~600 bytes typical, hard-capped): oversize input fails the block
 * (dropped with a marker), never silently truncated.
 */
export interface OperationalContextDeps {
  listApprovals(projectId: string): Promise<Array<{ approvalId: string; status: string }>>;
  approvalActionability(approvalId: string): Promise<{ state: ApprovalActionabilityState } | null>;
  projectLifecycles(projectId: string, limit: number): Promise<CanonicalLifecycle[]>;
}

export const OPERATIONAL_CONTEXT_MAX_BYTES = 2000;

export async function resolveOperationalContext(
  deps: OperationalContextDeps,
  projectId: string,
): Promise<Record<string, Json> | null> {
  try {
    const [approvals, lifecycles] = await Promise.all([
      deps.listApprovals(projectId),
      deps.projectLifecycles(projectId, 3),
    ]);
    const pending = approvals.filter((a) => a.status !== "DECIDED");
    let actionable = 0;
    // V5: record WHICH decisions are currently actionable (bounded), so V2
    // structured authority claims (targetDecisionId/ownerDecisionId) ground
    // against IDs, not against prose or a bare count. A classification error
    // still counts as actionable (fail-closed) but contributes no ID, so no
    // Owner-action claim can ground on an unverified decision.
    const actionableIds: string[] = [];
    for (const a of pending.slice(0, 20)) {
      try {
        const c = await deps.approvalActionability(a.approvalId);
        if (c && (c.state === "ACTION_REQUIRED" || c.state === "CONFLICTED")) {
          actionable++;
          actionableIds.push(a.approvalId);
        }
      } catch {
        actionable++;
      }
    }
    const latest = lifecycles[0] ?? null;
    const snapshot: Record<string, unknown> = {
      latestWorkflow: latest ? {
        title: latest.title,
        state: latest.overallState,
        label: latest.overallLabel,
        attention: latest.attention.filter((x) => x.kind === "APPROVAL").length,
        lastMilestone: latest.lastMilestone,
      } : null,
      approvals: { pending: pending.length, actionable, actionableIds },
      production: latest?.productionApproval ?? "UNKNOWN",
      publication: latest?.publicationApproval ?? "UNKNOWN",
      publicStatus: latest?.publicStatus ?? "UNKNOWN",
    };
    const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
    if (bytes > OPERATIONAL_CONTEXT_MAX_BYTES) return null;
    return snapshot as Record<string, Json>;
  } catch {
    return null;
  }
}

/** Fail before provider submission if a Morroway request lost its governing identity. */
export function assertMorrowayHistoricalContext(prompt: string, context: Record<string, Json>): void {
  if (!/historical\s+(pov|perspective)/i.test(prompt)) return;
  const text = JSON.stringify(context).toLowerCase();
  for (const required of ["morroway", "real-world", "historical", "morrowind", "elder scrolls", "game", "fantasy"]) {
    if (!text.includes(required)) throw new Error(`MORROWAY_CONTEXT_INCOMPLETE:${required}`);
  }
}
