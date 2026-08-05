# Trends

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `trends.ts` | `MetricTimeSeries`, `TrendAnalysis`, `SeasonalDecomposition`, `AnomalyDetection`, `TrendAlertConfig`, `TrendMonitor`, `TimeSeriesStore` | #7 |

Trend analysis with linear/exponential fit, R², p-values. Anomaly detection with configurable sensitivity. Seasonal decomposition. Forecasting with confidence intervals. Alerting on trend reversal, threshold cross, anomalies.