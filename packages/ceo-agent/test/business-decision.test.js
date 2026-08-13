import { strictEqual, deepStrictEqual, notStrictEqual, ok } from "node:assert";
import { describe, it } from "node:test";
import {
  decideBusinessCycle,
  validateBusinessFeedback,
} from "../dist/index.js";

const FIXED_CLOCK = () => "2026-08-13T00:00:00.000Z";

function artifact(overrides) {
  return {
    artifactId: `${overrides.kind}-1`,
    kind: overrides.kind,
    producerAgent: overrides.producerAgent ?? "analytics",
    workflowId: "workflow-biz",
    correlationId: "corr-biz",
    status: overrides.status ?? "completed",
    createdAt: "2026-08-12T00:00:00.000Z",
    payload: overrides.payload ?? {},
    ...(overrides.parentArtifact ? { parentArtifact: overrides.parentArtifact } : {}),
  };
}

function analytics(overrides = {}) {
  return artifact({
    kind: "analytics_report",
    producerAgent: "analytics",
    payload: {
      reportId: "analytics-1",
      publicationId: "pub-1",
      contentId: "content-1",
      status: "completed",
      summary: "ok",
      metrics: { views: 1200, likes: 300 },
      executionEvidencePresent: true,
      ...overrides.payload,
    },
    ...overrides,
  });
}

function growth(overrides = {}) {
  return artifact({
    kind: "growth_report",
    producerAgent: "growth",
    payload: {
      recommendationId: "growth-1",
      objective: "grow",
      contentId: "content-1",
      status: "completed",
      summary: "ok",
      winningPatterns: [],
      losingPatterns: [{ metric: "watch_time" }],
      recommendations: [],
      experiments: [],
      priorities: [],
      confidence: 0.9,
      sourceArtifactReferences: [{ artifactId: "analytics-1", kind: "analytics_report" }],
      ...overrides.payload,
    },
    ...overrides,
  });
}

function finance(overrides = {}) {
  return artifact({
    kind: "finance_report",
    producerAgent: "finance",
    payload: {
      reportId: "finance-1",
      contentId: "content-1",
      status: "completed",
      summary: "ok",
      revenue: 1000,
      cost: 400,
      profit: 600,
      roi: 1.5,
      margin: 0.6,
      confidence: 0.9,
      sourceArtifactReferences: [{ artifactId: "analytics-1", kind: "analytics_report" }],
      ...overrides.payload,
    },
    ...overrides,
  });
}

function validInput(overrides = {}) {
  return {
    requestId: "request-1",
    cycle: 1,
    maxCycles: 5,
    workflowId: "workflow-biz",
    correlationId: "corr-biz",
    brandId: null,
    validatedArtifacts: [analytics(), growth(), finance()],
    clock: FIXED_CLOCK,
    ...overrides,
  };
}

// NOTE: decision input may reference a partial registry; ALL template agents for
// the grounded "implement" intent may not be present. Provide a permissive registry
// so the existing CEOAgent accepts the template without inventing agents.
const PERMISSIVE = { has: () => true };

describe("Business feedback loop — validation (Analytics + Growth + Finance → CEO)", () => {
  it("accepts a fully validated analytics + growth + finance chain", () => {
    const gate = validateBusinessFeedback(validInput());
    strictEqual(gate.ok, true);
  });

  it("issues a grounded ExecutiveDirective reusing the CEO decision layer", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE }));
    strictEqual(decision.status, "issued");
    ok(decision.directive);
    strictEqual(decision.directive.workflowIntent, "implement");
    strictEqual(decision.directive.decisionEvidence.kind, "executive_decision");
    strictEqual(decision.directive.sourceArtifactReferences.length, 3);
    ok(decision.directive.rationale.includes("finance_report"));
    // grounded criteria reference the validated losing metric / roi, no invented figures
    ok(decision.directive.successCriteria.some((c) => c.includes("watch_time")));
    ok(decision.directive.successCriteria.some((c) => c.includes("1.5")));
  });

  it("grounds objective/priority only in validated figures (no fabricated metrics)", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE }));
    const d = decision.directive;
    // profit=600>0, roi=1.5>=1 → medium; objective references real contentId & roi
    strictEqual(d.priority, "medium");
    ok(d.objective.includes("content-1"));
    ok(d.objective.includes("1.5"));
  });

  it("raises priority to urgent when validated profit is negative", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [analytics(), growth(), finance({ payload: { profit: -100, roi: -0.2 } })] }));
    strictEqual(decision.status, "issued");
    strictEqual(decision.directive.priority, "urgent");
  });

  it("raises priority to high when validated ROI is below 1 (non-negative profit)", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [analytics(), growth(), finance({ payload: { profit: 50, roi: 0.8 } })] }));
    strictEqual(decision.status, "issued");
    strictEqual(decision.directive.priority, "high");
  });

  it("is deterministic for an identical validated chain", () => {
    const a = decideBusinessCycle(validInput({ registry: PERMISSIVE }));
    const b = decideBusinessCycle(validInput({ registry: PERMISSIVE }));
    deepStrictEqual(a, b);
    strictEqual(a.directive.directiveId, b.directive.directiveId);
  });
});

describe("Business feedback loop — safe refusal (no decision on invalid upstream)", () => {
  it("stops when analytics is missing", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [growth(), finance()] }));
    strictEqual(decision.status, "no_decision");
    strictEqual(decision.directive, undefined);
    ok(decision.reason.includes("analytics_report"));
  });

  it("stops when growth is missing", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [analytics(), finance()] }));
    strictEqual(decision.status, "no_decision");
    ok(decision.reason.includes("growth_report"));
  });

  it("stops when finance is missing or incomplete", () => {
    const missing = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [analytics(), growth()] }));
    strictEqual(missing.status, "no_decision");
    ok(missing.reason.includes("finance_report"));
    const incomplete = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [analytics(), growth(), finance({ status: "blocked" })] }));
    strictEqual(incomplete.status, "no_decision");
    ok(incomplete.reason.includes("blocked"));
  });

  it("stops when any upstream artifact is blocked or failed", () => {
    for (const st of ["blocked", "failed"]) {
      const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [analytics({ status: st }), growth(), finance()] }));
      strictEqual(decision.status, "no_decision");
      ok(decision.reason.includes("blocked/failed"));
    }
  });

  it("stops when analytics lacks numeric metrics or execution evidence", () => {
    const noMetrics = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [analytics({ payload: { metrics: {} } }), growth(), finance()] }));
    strictEqual(noMetrics.status, "no_decision");
    ok(noMetrics.reason.includes("numeric metrics"));
    const noEvidence = decideBusinessCycle(validInput({ registry: PERMISSIVE, validatedArtifacts: [analytics({ payload: { executionEvidencePresent: false, metrics: { views: 1 } } }), growth(), finance()] }));
    strictEqual(noEvidence.status, "no_decision");
    ok(noEvidence.reason.includes("execution evidence"));
  });

  it("never fabricates a directive on any refusal (directive stays undefined)", () => {
    const cases = [
      validInput({ registry: PERMISSIVE, validatedArtifacts: [] }),
      validInput({ registry: PERMISSIVE, cycle: 0 }),
      validInput({ registry: PERMISSIVE, maxCycles: 0 }),
    ];
    for (const input of cases) {
      const decision = decideBusinessCycle(input);
      strictEqual(decision.status, "no_decision");
      strictEqual(decision.directive, undefined);
    }
  });
});

describe("Business feedback loop — cycle safety (bounded, no infinite loop)", () => {
  it("rejects a cycle beyond maxCycles with no directive", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE, cycle: 6, maxCycles: 5 }));
    strictEqual(decision.status, "no_decision");
    strictEqual(decision.directive, undefined);
    ok(decision.reason.includes("cycle limit"));
  });

  it("rejects further cycles when the loop is not allowed to continue", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE, allowFurtherCycles: false }));
    strictEqual(decision.status, "no_decision");
    strictEqual(decision.directive, undefined);
    ok(decision.reason.includes("not allowed"));
  });

  it("issues a fresh directive for a subsequent in-range cycle with identity preserved", () => {
    const first = decideBusinessCycle(validInput({ registry: PERMISSIVE, cycle: 1 }));
    const second = decideBusinessCycle(validInput({ registry: PERMISSIVE, cycle: 2 }));
    strictEqual(first.status, "issued");
    strictEqual(second.status, "issued");
    strictEqual(first.directive.cycle, 1);
    strictEqual(second.directive.cycle, 2);
    strictEqual(first.directive.decisionEvidence.evidenceId !== second.directive.decisionEvidence.evidenceId, true);
    // objective rationale differ because analytics metrics differ across cycles is not the case here;
    // but evidenceId/directiveId must not collide for distinct cycles (cycle is part of the decision).
    notStrictEqual(first.directive.directiveId, second.directive.directiveId);
  });

  it("never runs forever: a bounded loop terminates exactly at maxCycles (no infinite loop)", () => {
    const maxCycles = 10;
    let iterations = 0;
    let issuedCount = 0;
    let status = "issued";
    while (status === "issued" && iterations < 1000) {
      iterations += 1;
      const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE, cycle: iterations, maxCycles }));
      status = decision.status;
      if (status === "issued") {
        issuedCount += 1;
        strictEqual(decision.directive.cycle, iterations);
      }
    }
    strictEqual(issuedCount, maxCycles);
    strictEqual(status, "no_decision");
    strictEqual(iterations, maxCycles + 1);
  });
});

describe("Business feedback loop — provenance & decision/execution distinctness", () => {
  it("records decision provenance with source artifact references only", () => {
    const decision = decideBusinessCycle(validInput({ registry: PERMISSIVE }));
    strictEqual(decision.status, "issued");
    const refs = decision.sourceArtifactReferences;
    deepStrictEqual(refs.map((r) => r.kind).sort(), ["analytics_report", "finance_report", "growth_report"].sort());
    ok(decision.directive.decisionEvidence.kind, "executive_decision");
    // no execution evidence / capability result surface
    strictEqual(decision.directive.decisionEvidence.status, undefined);
    strictEqual(decision.directive.decisionEvidence.succeeded, undefined);
    // the directive itself is a decision artifact and exposes no executor
    strictEqual(decision.directive.decisionEvidence.executeCapability, undefined);
  });
});