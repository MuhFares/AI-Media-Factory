/**
 * Program 4 — analytics domain endpoints (read-only).
 * Composes existing canonical stores (content, lifecycle, learning,
 * persistence, control) with the deterministic analytics-intelligence
 * engines. No persistence, no execution, no authority changes. Agent-ready:
 * stable JSON shapes documented in analytics-intelligence-v1.md.
 */
import type {
  ContentStore, LifecycleStore, LearningLoopStore, PostgresPersistence,
  ControlPlaneStore,
  MetricDefinition,
} from "@ai-media-factory/database";
import {
  METRIC_DEFINITIONS,
  metricDefinition, computeKpis, compareEntities, trendOf, TREND_RULE,
  comparisonInsight, sparsenessInsight, providerGapInsight,
  experimentEvaluabilityInsight, analyzeContributor,
  rollupProvider, compareProviders,
  windowsCompatible,
} from "@ai-media-factory/database";
import type { MeasurementWindow } from "@ai-media-factory/database";

export interface AnalyticsDeps {
  readonly control: ControlPlaneStore;
  readonly persistence: PostgresPersistence;
  readonly lifecycle?: LifecycleStore;
  readonly content?: ContentStore;
  readonly learning?: LearningLoopStore;
}

export { METRIC_DEFINITIONS };

export function metricCatalog(): { metrics: MetricDefinition[] } {
  return { metrics: [...METRIC_DEFINITIONS] };
}

interface ContentPerf {
  contentId: string;
  title: string;
  status: string;
  workflowId: string | null;
  metrics: Record<string, unknown>;
  transportProvenance: string | null;
  windowDays: number | null;
  observedAt: string | null;
}

async function contentPerformances(deps: AnalyticsDeps, projectId: string): Promise<ContentPerf[]> {
  if (!deps.content) return [];
  const items = await deps.content.listContent(projectId);
  const obs = deps.learning ? await deps.learning.listObservations(projectId, 200) : [];
  return items.map((c) => {
    const mine = obs.filter((o) => c.workflowId && o.workflowId === c.workflowId);
    const latest = mine.sort((a, b) => String(b.observedAt || "").localeCompare(String(a.observedAt || "")))[0];
    return {
      contentId: c.contentId,
      title: c.title,
      status: "",
      workflowId: c.workflowId,
      metrics: latest ? { ...(latest.metrics as Record<string, unknown>) } : {},
      transportProvenance: latest ? latest.transportProvenance : null,
      windowDays: latest && latest.windowStart && latest.windowEnd
        ? Math.max(0, Math.round((Date.parse(latest.windowEnd) - Date.parse(latest.windowStart)) / 86400000))
        : null,
      observedAt: latest ? latest.observedAt : null,
    };
  });
}

function windowOf(p: ContentPerf): MeasurementWindow | null {
  if (p.windowDays === null) return null;
  return {
    label: `${p.windowDays}d`, windowDays: p.windowDays,
    windowStart: null, windowEnd: p.observedAt,
    provenance: p.transportProvenance, platform: "youtube",
  };
}

export async function analyticsOverview(deps: AnalyticsDeps, projectId: string): Promise<Record<string, unknown>> {
  const perfs = await contentPerformances(deps, projectId);
  const measured = perfs.filter((p) => Object.keys(p.metrics).length > 0);
  const pending = perfs.filter((p) => Object.keys(p.metrics).length === 0);
  const learnings = deps.learning ? await deps.learning.listLearnings(projectId, 200) : [];
  const recs = deps.learning ? await deps.learning.listRecommendations(projectId, 200) : [];
  const props = deps.learning ? await deps.learning.listProposals(projectId, 200) : [];
  const awaiting = props.filter((p) => p.status === "AWAITS_OWNER_DECISION");
  const experiments = [...new Set([
    ...learnings.map((l) => l.experimentId).filter((x): x is string => !!x),
  ])];
  return {
    projectId,
    contents: perfs.length,
    measured: measured.length,
    awaitingMeasurement: pending.length,
    learnings: learnings.length,
    recommendations: recs.length,
    proposalsAwaitingDecision: awaiting.length,
    experimentsTracked: experiments.length,
    availability: perfs.length === 0
      ? "EMPTY"
      : pending.length === perfs.length ? "NOT_YET_AVAILABLE" : "PARTIAL",
  };
}

export async function analyticsContent(deps: AnalyticsDeps, projectId: string): Promise<Record<string, unknown>> {
  const perfs = await contentPerformances(deps, projectId);
  let telemetry: Record<string, unknown>[] = [];
  try {
    telemetry = (await deps.control.telemetry(projectId)) as Record<string, unknown>[];
  } catch {
    telemetry = [];
  }
  const costOf = (workflowId: string | null): { known: number | null; unknown: number } => {
    if (!workflowId) return { known: null, unknown: 0 };
    const rows = telemetry.filter((t) => t.workflow_id === workflowId);
    const priced = rows.filter((t) => typeof t.cost === "number" && Number.isFinite(t.cost as number));
    return {
      known: priced.length > 0 ? priced.reduce((s, t) => s + Number(t.cost), 0) : null,
      unknown: rows.length - priced.length,
    };
  };
  const learnings = deps.learning ? await deps.learning.listLearnings(projectId, 200) : [];
  const obsByWorkflow = new Map<string, Set<string>>();
  if (deps.learning) {
    for (const o of await deps.learning.listObservations(projectId, 200)) {
      if (!o.workflowId) continue;
      if (!obsByWorkflow.has(o.workflowId)) obsByWorkflow.set(o.workflowId, new Set());
      obsByWorkflow.get(o.workflowId)!.add(o.observationId);
    }
  }
  const learningByWorkflow = new Map<string, number>();
  for (const l of learnings) {
    for (const [wf, ids] of obsByWorkflow) {
      if (l.sourceObservationIds.some((id) => ids.has(id))) {
        learningByWorkflow.set(wf, (learningByWorkflow.get(wf) ?? 0) + 1);
      }
    }
  }
  return {
    projectId,
    contents: perfs.map((p) => {
      const metrics = p.metrics as Record<string, number>;
      const kpis = computeKpis({
        views: metrics.views, likes: metrics.likes, comments: metrics.comments,
        shares: metrics.shares, watchTimeSeconds: metrics.watchTimeSeconds,
        averageViewDuration: metrics.averageViewDuration, windowDays: p.windowDays,
      });
      const hasData = Object.keys(p.metrics).length > 0;
      const cost = costOf(p.workflowId);
      return {
        contentId: p.contentId, title: p.title, status: p.status,
        workflowId: p.workflowId, metrics: p.metrics,
        transportProvenance: p.transportProvenance,
        measurementState: !p.workflowId ? "UNKNOWN" : !hasData ? "NOT_YET_AVAILABLE" : "AVAILABLE",
        windowDays: p.windowDays, observedAt: p.observedAt,
        kpis: kpis.map((k) => ({ name: k.name, state: k.state, value: k.value, reason: k.reason })),
        learnings: p.workflowId ? learningByWorkflow.get(p.workflowId) ?? 0 : 0,
        costKnown: cost.known,
        costUnknownRuns: cost.unknown,
      };
    }),
  };
}

export async function analyticsContentDetail(
  deps: AnalyticsDeps, projectId: string, contentId: string,
): Promise<Record<string, unknown> | null> {
  if (!deps.content) return null;
  const item = await deps.content.getContent(contentId);
  if (!item || item.projectId !== projectId) return null;
  let lifecycle: unknown = null;
  let artifacts: unknown[] = [];
  let readiness: unknown = null;
  if (item.workflowId && deps.lifecycle) {
    try {
      lifecycle = await deps.lifecycle.workflowLifecycle(item.workflowId);
    } catch { lifecycle = null; }
    try {
      artifacts = await deps.persistence.listArtifacts(item.workflowId);
    } catch { artifacts = []; }
    try {
      readiness = await deps.control.publicationReadiness(projectId, item.workflowId);
    } catch { readiness = null; }
  }
  const perfs = await contentPerformances(deps, projectId);
  const perf = perfs.find((p) => p.contentId === contentId) ?? null;
  const kpis = perf ? computeKpis({
    views: (perf.metrics as Record<string, number>).views,
    likes: (perf.metrics as Record<string, number>).likes,
    comments: (perf.metrics as Record<string, number>).comments,
    shares: (perf.metrics as Record<string, number>).shares,
    watchTimeSeconds: (perf.metrics as Record<string, number>).watchTimeSeconds,
    averageViewDuration: (perf.metrics as Record<string, number>).averageViewDuration,
    windowDays: perf.windowDays,
  }) : [];
  let trend: unknown = null;
  if (deps.learning && item.workflowId) {
    const obs = (await deps.learning.listObservations(projectId, 200))
      .filter((o) => o.workflowId === item.workflowId)
      .sort((a, b) => String(a.observedAt || "").localeCompare(String(b.observedAt || "")));
    const views = obs.map((o) => (o.metrics as Record<string, unknown>).views);
    if (views.length >= 3 || views.length > 0) {
      const t = trendOf(views);
      trend = { state: t.state, rule: t.rule, detail: t.detail, points: views.length };
    }
  }
  return { content: item, lifecycle, artifacts, readiness, performance: perf, kpis, trend };
}

export async function analyticsCompare(
  deps: AnalyticsDeps, projectId: string, aId: string, bId: string, metric: string,
): Promise<Record<string, unknown>> {
  const perfs = await contentPerformances(deps, projectId);
  const a = perfs.find((p) => p.contentId === aId);
  const b = perfs.find((p) => p.contentId === bId);
  if (!a || !b) return { error: "CONTENT_NOT_FOUND", quality: "NOT_APPLICABLE" };
  const rawOf = (p: (typeof perfs)[number]): unknown => {
    const direct = (p.metrics as Record<string, unknown>)[metric];
    if (typeof direct === "number" && Number.isFinite(direct)) return direct;
    if (!metricDefinition(metric)) return undefined;
    const m = p.metrics as Record<string, number>;
    const kpis = computeKpis({
      views: m.views, likes: m.likes, comments: m.comments, shares: m.shares,
      watchTimeSeconds: m.watchTimeSeconds, averageViewDuration: m.averageViewDuration,
      windowDays: p.windowDays,
    });
    const k = kpis.find((k) => k.name === metric);
    return k && k.state === "OK" ? k.value : undefined;
  };
  if (!metricDefinition(metric) && rawOf(a) === undefined && rawOf(b) === undefined) {
    return { error: `UNSUPPORTED_METRIC:${metric}`, quality: "NOT_APPLICABLE" };
  }
  const result = compareEntities({
    labelA: a.title, labelB: b.title,
    metricA: rawOf(a),
    metricB: rawOf(b),
    windowA: windowOf(a), windowB: windowOf(b),
  });
  const insight = comparisonInsight({
    labelA: a.title, labelB: b.title, metric,
    leader: result.leader, quality: result.quality,
    window: a.windowDays !== null && a.windowDays === b.windowDays ? `${a.windowDays}d` : null,
    evidenceRefs: [a.contentId, b.contentId],
  });
  return { metric, a: a.contentId, b: b.contentId, ...result, insight };
}

export async function analyticsExperiments(deps: AnalyticsDeps, projectId: string): Promise<Record<string, unknown>> {
  const learnings = deps.learning ? await deps.learning.listLearnings(projectId, 200) : [];
  const obs = deps.learning ? await deps.learning.listObservations(projectId, 200) : [];
  const byExp = new Map<string, { observations: number; learnings: number }>();
  for (const o of obs) {
    if (!o.experimentId) continue;
    const e = byExp.get(o.experimentId) ?? { observations: 0, learnings: 0 };
    e.observations += 1;
    byExp.set(o.experimentId, e);
  }
  for (const l of learnings) {
    if (!l.experimentId) continue;
    const e = byExp.get(l.experimentId) ?? { observations: 0, learnings: 0 };
    e.learnings += 1;
    byExp.set(l.experimentId, e);
  }
  return {
    projectId,
    experiments: [...byExp.entries()].map(([experimentId, counts]) => {
      const evaluable = counts.observations > 0;
      return {
        experimentId, ...counts,
        evaluable,
        status: evaluable ? "EVALUABLE" : "INSUFFICIENT_DATA",
        evaluation: null,
      };
    }),
  };
}

export async function analyticsInsights(deps: AnalyticsDeps, projectId: string): Promise<Record<string, unknown>> {
  const perfs = await contentPerformances(deps, projectId);
  const measured = perfs.filter((p) => Object.keys(p.metrics).length > 0);
  const insights = [];
  insights.push(sparsenessInsight({
    scope: `Morroway content (${perfs.length} item(s))`,
    measured: measured.length, pending: perfs.length - measured.length,
    evidenceRefs: perfs.map((p) => p.contentId),
  }));
  insights.push(providerGapInsight({
    providerA: "self-hosted-image", providerB: "runpod-zimage",
    comparableEvidence: false, evidenceRefs: [],
  }));
  const exps = await analyticsExperiments(deps, projectId);
  for (const e of (exps.experiments as { experimentId: string; evaluable: boolean }[])) {
    insights.push(experimentEvaluabilityInsight({
      experimentId: e.experimentId, evaluable: e.evaluable,
      reason: e.evaluable ? "observations linked" : "no linked observations",
      evidenceRefs: [e.experimentId],
    }));
  }
  return { projectId, insights: insights.filter((i) => i !== null) };
}

export async function analyticsAvailability(deps: AnalyticsDeps, projectId: string): Promise<Record<string, unknown>> {
  const perfs = await contentPerformances(deps, projectId);
  return {
    projectId,
    contents: perfs.map((p) => ({
      contentId: p.contentId,
      title: p.title,
      state: !p.workflowId ? "UNKNOWN" : Object.keys(p.metrics).length > 0 ? "AVAILABLE" : "NOT_YET_AVAILABLE",
      transportProvenance: p.transportProvenance,
      observedAt: p.observedAt,
      windowDays: p.windowDays,
    })),
  };
}

/** Agent-ready evidence query: factual answers with references, no narrative. */
export async function analyticsAgentQuery(
  deps: AnalyticsDeps, projectId: string, question: string,
): Promise<Record<string, unknown>> {
  const q = question.toLowerCase();
  const perfs = await contentPerformances(deps, projectId);
  const withViews = perfs
    .filter((p) => typeof (p.metrics as Record<string, unknown>).views === "number")
    .sort((a, b) => Number((b.metrics as Record<string, unknown>).views) - Number((a.metrics as Record<string, unknown>).views));
  if (/best|top|highest/.test(q)) {
    const top = withViews[0];
    return {
      question, answer: "best_by_views",
      evidence: top ? { contentId: top.contentId, title: top.title, views: (top.metrics as Record<string, unknown>).views } : null,
      evidenceQuality: top ? "COMPARABLE" : "INSUFFICIENT_DATA",
      reason: top ? "highest views among measured content" : "no measured views available",
    };
  }
  if (/compar|shorts.*long|long.*short|format/.test(q)) {
    return {
      question, answer: "format_comparison_unavailable",
      evidence: null, evidenceQuality: "INSUFFICIENT_DATA",
      reason: "format comparison needs measured content in both formats",
    };
  }
  if (/experiment|evidence|test/.test(q)) {
    const exps = await analyticsExperiments(deps, projectId);
    const list = exps.experiments as { experimentId: string; evaluable: boolean }[];
    return {
      question, answer: "experiments_tracked",
      evidence: list, evidenceQuality: list.some((e) => e.evaluable) ? "PARTIAL" : "INSUFFICIENT_DATA",
      reason: "tracked experiments with evaluability flags",
    };
  }
  const overview = await analyticsOverview(deps, projectId);
  return {
    question, answer: "project_overview", evidence: overview,
    evidenceQuality: "INFORMATIONAL", reason: "unrecognized question; returning overview",
  };
}

export { windowsCompatible, TREND_RULE, analyzeContributor, rollupProvider, compareProviders };
export type { MeasurementWindow };
