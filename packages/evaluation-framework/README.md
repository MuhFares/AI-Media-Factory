# Evaluation Framework (`@ai-media-factory/evaluation-framework`)

> Architecture specification for the Evaluation Framework of AI Media Factory (AMF). **Contracts and architecture only** — the `src/**/*.ts` files are type/interface declarations with no implementation bodies. This framework is the **Quality Operating System** of the company — it continuously evaluates every component and drives continuous improvement.

## 0. Core Principle

**Measure everything, improve continuously.** The Evaluation Framework is the nervous system of AMF's quality. It doesn't just report metrics — it drives the continuous improvement loop that makes the system smarter over time.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    EVALUATION FRAMEWORK (Quality OS)                        │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│  │   AGENTS     │    │  PROVIDERS   │    │  WORKFLOWS   │  ← Evaluate     │
│  │  (13 agents) │    │  (6 vendors) │    │  (5 types)   │                 │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                 │
│         │                   │                   │                           │
│         └───────────────────┼───────────────────┘                           │
│                             ▼                                               │
│              ┌──────────────────────────────────────┐                       │
│              │         EVALUATION ENGINE             │                       │
│              │  (Continuous + On-demand + Scheduled) │                       │
│              └──────────────┬───────────────────────┘                       │
│                             │                                               │
│         ┌───────────────────┼───────────────────┐                           │
│         ▼                   ▼                   ▼                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│  │  METRICS    │    │ QUALITY     │    │  BENCHMARKS │                    │
│  │  SCORECARDS │    │  GATES      │    │  (Standard  │                    │
│  │             │    │             │    │   Suites)   │                    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                    │
│         │                  │                  │                              │
│         └──────────────────┼──────────────────┘                              │
│                            ▼                                                  │
│              ┌──────────────────────────────────────────┐                   │
│              │      REGRESSION DETECTION                │                   │
│              │  (Automatic + Scheduled + On-deploy)     │                   │
│              └──────────────┬───────────────────────────┘                   │
│                             │                                               │
│         ┌───────────────────┼───────────────────┐                           │
│         ▼                   ▼                   ▼                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                    │
│  │ LEADERBOARDS│    │   TRENDS    │    │ IMPROVEMENT │                    │
│  │  (Rankings) │    │  (Trends/   │    │    LOOP     │                    │
│  │             │    │   Anomalies)│    │  (Auto-opt) │                    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘                    │
│         │                  │                  │                              │
│         └──────────────────┼──────────────────┘                             │
│                            ▼                                                 │
│              ┌──────────────────────────────────────────┐                   │
│              │      EVALUATION REPORTS & DASHBOARD      │                   │
│              │  (Executive + Technical + Compliance)    │                   │
│              └──────────────────────────────────────────┘                   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. The 11 Requirements → Where Each Lives

| # | Requirement | Home |
|---|---|---|
| 1 | **Evaluation Metrics** | `metrics/metrics.ts` — 50+ standard metrics across 7 categories |
| 2 | **Scorecards** | `metrics/scorecard.ts` — Weighted scoring, category aggregation |
| 3 | **Quality Gates** | `gates/gates.ts` — 20+ standard gates with thresholds |
| 4 | **Benchmarks** | `benchmarks/benchmarks.ts` — 3 standard suites + extensible |
| 5 | **Regression Tests** | `regression/regression.ts` — Automated + scheduled + on-deploy |
| 6 | **Leaderboards** | `leaderboards/leaderboards.ts` — 9 standard leaderboards |
| 7 | **Historical Trends** | `trends/trends.ts` — Trend analysis, anomalies, forecasting |
| 8 | **Automatic Failures** | `gates/gates.ts` + `regression/regression.ts` — Auto-block on failure |
| 9 | **Continuous Improvement Loop** | `improvement/improvement.ts` — Auto-propose → review → execute → monitor |
| 10 | **Evaluation Reports** | `reports/reports.ts` — 4 templates (executive, technical, compliance, incident) |
| 11 | **Dashboard** | `observability/` — Metrics, logging, cost, metrics |

---

## 2. Folder Structure

```
packages/evaluation-framework/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # barrel (types only)
    ├── core/
    │   ├── README.md
    │   ├── common.ts               # Shared primitives
    │   ├── engine.ts               # EvaluationEngine interface
    │   └── request.ts              # EvaluationRequest, EvaluationResult
    ├── metrics/
    │   ├── README.md
    │   ├── metrics.ts              # 50+ standard metrics
    │   └── scorecard.ts            # Scorecard, MetricScore, CategoryScore
    ├── gates/
    │   ├── README.md
    │   └── gates.ts                # 20+ standard quality gates
    ├── benchmarks/
    │   ├── README.md
    │   └── benchmarks.ts           # 3 standard benchmarks + framework
    ├── regression/
    │   README.md
    │   └── regression.ts           # Regression tests + scheduling
    ├── leaderboards/
    │   ├── README.md
    │   └── leaderboards.ts         # 9 standard leaderboards
    ├── trends/
    │   ├── README.md
    │   └── trends.ts               # Trend analysis, anomalies, forecasting
    ├── improvement/
    │   ├── README.md
    │   └── improvement.ts          # Continuous improvement loop
    ├── reports/
    │   ├── README.md
    └──   reports.ts                # 4 report templates + generator
    ├── observability/
    │   └── metrics.ts              # (or shared with other packages)
    ├── core/
    │   ├── common.ts               # Shared primitives
    │   ├── engine.ts               # EvaluationEngine interface
    │   └── request.ts              # EvaluationRequest, EvaluationResult
    ├── index.ts                    # barrel export
    ├── package.json
    └── tsconfig.json
```

---

## 2. Core Evaluation Loop

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CONTINUOUS EVALUATION LOOP                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. TRIGGER                                                                  │
│     ├── Scheduled (cron)          ──► Runs daily/weekly                    │
│     ├── Post-execution            ──► After each workflow/agent run        │
│     ├── On deployment             ──► After every deployment               │
│     ├── On regression alert       ──► Triggered by anomaly detection       │
│     └── On demand                 ──► Manual / API trigger                 │
│                              │                                              │
│                              ▼                                              │
│  2. COLLECT                                                                   │
│     ├── Agent metrics (from Analytics Brain)                                 │
│     ├── Provider metrics (from Provider Layer)                              │
│     ├── Workflow metrics (from Workflow Engine)                             │
│     ├── Prompt metrics (from Prompt Compiler)                               │
│     ├── Memory metrics (from Memory Engine)                                 │
│     ├── Tool metrics (from Tool Framework)                                  │
│     └── Output quality (from Analytics)                                     │
│                              │                                              │
│                              ▼                                              │
│  3. EVALUATE                                                                  │
│     ├── Run benchmarks (standard suites)                                     │
│     ├── Score against metrics (scorecards)                                   │
│     ├── Check quality gates (pass/warn/fail/block)                          │
│     ├── Run regression tests (statistical comparison)                       │
│     └── Update leaderboards & trends                                        │
│                              │                                              │
│                              ▼                                              │
│  4. DECIDE                                                                    │
│     ├── Quality gates: pass/warn/fail/block                                  │
│     ├── Regression: pass/regression/improvement                             │
│     ├── Generate improvement proposals (auto)                               │
│     └── Update leaderboards                                                 │
│                              │                                              │
│                              ▼                                              │
│  5. ACT                                                                       │
│     ├── Auto-approve low-risk improvements                                  │
│     ├── Escalate high-risk to human                                         │
│     ├── Execute approved changes                                            │
│     ├── Monitor impact                                                      │
│     └── Rollback if negative impact                                         │
│                              │                                              │
│                              ▼                                              │
│  6. REPORT & LEARN                                                            │
│     ├── Generate evaluation reports (4 templates)                           │
│     ├── Update leaderboards & trends                                        │
│     ├── Feed improvement loop                                               │
│     └── Archive for historical analysis                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Key Components

### 3.1 Evaluation Engine
Single entry point: `EvaluationEngine.evaluate(request) → EvaluationResult`
- Supports sync and async execution
- Supports scheduled, on-demand, post-execution, post-deployment triggers
- Parallel execution with configurable concurrency
- Fail-fast option for critical evaluations

### 3.2 Metrics (50+ Standard Metrics)
| Category | Metrics |
|---|---|
| **Agent** | task_success_rate, avg_latency_ms, autonomy_rate, retry_rate |
| **Provider** | availability, latency_p95, error_rate, cost_per_1k_tokens |
| **Workflow** | success_rate, avg_duration_ms, rework_rate, autonomy_rate |
| **Prompt** | token_efficiency, schema_compliance |
| **Memory** | retrieval_precision, retrieval_recall, conflict_rate |
| **Tool** | success_rate, avg_latency_ms, cost_per_call |
| **Output** | quality_score, schema_compliance, brand_safety |

### 3.3 Quality Gates (20+ Standard)
| Gate | Target | Pass Threshold | Action |
|---|---|---|---|
| Agent Success Rate | ≥ 95% | fail | Agent |
| Provider Availability | ≥ 99.9% | fail | Provider |
| Workflow Success Rate | ≥ 95% | fail | Workflow |
| Output Brand Safety | ≥ 99% | block | Output |
| Output Schema Compliance | ≥ 99% | fail | Output |

### 3.4 Benchmarks
- **agent.comprehensive** — Full agent capability test
- **provider.reliability** — Provider uptime/latency under load
- **workflow.content_pipeline** — End-to-end content pipeline

### 3.5 Regression Testing
- **Daily full regression** (2 AM)
- **On deployment** (triggered by deployment)
- **Weekly comprehensive** (Sunday 3 AM)
- Statistical significance testing (p-value, effect size)

### 3.6 Continuous Improvement Loop
```
Analyze → Propose → Review → Execute → Monitor → Rollback if needed
    ↑                                                                    │
    └────────────────────────── Learning Loop ──────────────────────────┘
```
- Auto-proposes improvements (parameter tuning, prompt optimization, model switches)
- Risk assessment per proposal
- Auto-approve low-risk; human review for high-risk
- Rollback on negative impact

### 3.6 Leaderboards (9 Standard)
- Agent: top_performers, fastest, most_autonomous
- Provider: best_uptime, lowest_cost
- Workflow: most_reliable
- Tool: most_reliable, most_cost_effective
- Prompt: highest_quality, most_efficient

### 3.7 Trends & Anomalies
- Trend analysis (linear/exponential fit, R², p-value)
- Anomaly detection (statistical + ML)
- Seasonal decomposition
- Forecasting with confidence intervals
- Alert on trend reversal / threshold cross / anomaly

### 3.7 Reports (4 Templates)
1. **Executive Summary** — For leadership
2. **Detailed Technical** — For engineering
3. **Compliance Audit** — For governance
4. **Incident Postmortem** — For incidents

---

## 4. Integration Points

| Consumer | Interface | Purpose |
|---|---|---|
| **Runtime** | `EvaluationEngine.evaluate()` | Post-execution evaluation |
| **Workflow Engine** | `EvaluationEngine.evaluate()` | Post-workflow evaluation |
| **Analytics Brain** | Metrics subscription | Feeds insights |
| **CEO Decision Engine** | Gate decisions + Reports | Strategic decisions |
| **Improvement Loop** | Proposals + Results | Continuous improvement |
| **Event Bus** | Events | Triggers + notifications |

---

## 5. Boundaries

- **Never modifies production state directly** — only proposes, reports, evaluates
- **Never bypasses quality gates** — gates are enforced by Workflow Engine
- **Never makes deployment decisions** — only provides evidence for decisions
- **Never stores secrets** — reads metrics from observability layer

---

## Status

Contracts and architecture only. No implementation. This is the specification an Evaluation Framework implementation will satisfy.

---

## Related Documents

- [Runtime](../runtime/README.md) — Consumer of evaluation
- [Workflow Engine](../workflow-engine/README.md) — Consumer + trigger
- [Analytics Brain](../../memory/company/analytics-brain.md) — Metrics source
- [CEO Decision Engine](../memory/company/ceo-decision-engine.md) — Consumer of gate decisions
- [Improvement Loop](./improvement/improvement.ts) — Continuous improvement
- [Memory Intelligence](../../memory/company/memory-intelligence.md) — Knowledge for evaluation