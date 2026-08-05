# Benchmarks

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `benchmarks.ts` | `Benchmark`, `BenchmarkTestCase`, `BenchmarkScoring`, `BenchmarkBaseline`, `BenchmarkRun`, `STANDARD_BENCHMARKS` | #4 |

3 standard benchmarks: `agent.comprehensive` (full agent eval), `provider.reliability` (provider uptime/latency), `workflow.content_pipeline` (end-to-end content pipeline). Extensible via `Benchmark` interface.