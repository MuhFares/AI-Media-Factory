/**
 * Historical Trends - Track metrics over time.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Timestamp, Json } from "../core/common";

/** Time-series data point. */
export interface TimeSeriesPoint {
  timestamp: string;
  value: number;
  metadata?: Record<string, any>;
}

/** Time series for a specific metric. */
export interface MetricTimeSeries {
  metricId: string;
  entityType: string;
  entityId: string;
  dataPoints: TimeSeriesPoint[];
  granularity: "hourly" | "daily" | "weekly" | "monthly";
  retentionDays: number;
}

/** Trend analysis result. */
export interface TrendAnalysis {
  metricId: string;
  entityType: string;
  entityId: string;
  /** Time window analyzed. */
  window: {
    start: string;
    end: string;
  };
  /** Overall trend direction. */
  trend: "increasing" | "decreasing" | "stable" | "volatile";
  /** Trend strength (0-1). */
  strength: number;
  /** Slope (change per unit time). */
  slope: number;
  /** Statistical significance. */
  pValue: number;
  /** R-squared value. */
  rSquared: number;
  /** Key inflection points. */
  inflectionPoints: InflectionPoint[];
  /** Forecast for next period. */
  forecast?: ForecastPoint[];
  analyzedAt: string;
}

export interface InflectionPoint {
  timestamp: string;
  value: number;
  type: "peak" | "trough" | "trend_change";
  significance: number;
}

export interface ForecastPoint {
  timestamp: string;
  predictedValue: number;
  confidenceInterval: [number, number];
}

/** Seasonal decomposition result. */
export interface SeasonalDecomposition {
  metricId: string;
  entityType: string;
  entityId: string;
  trend: TimeSeriesPoint[];
  seasonal: TimeSeriesPoint[];
  residual: TimeSeriesPoint[];
  period: number; // days
}

/** Anomaly detection result. */
export interface AnomalyDetection {
  metricId: string;
  entityType: string;
  entityId: string;
  anomalies: AnomalyPoint[];
  detectionMethod: string;
  sensitivity: number;
  detectedAt: string;
}

export interface AnomalyPoint {
  timestamp: string;
  expectedValue: number;
  actualValue: number;
  deviation: number; // standard deviations
  severity: "low" | "medium" | "high" | "critical";
  context?: Json;
}

/** Trend alert configuration. */
export interface TrendAlertConfig {
  metricId: string;
  entityType: string;
  entityId: string;
  conditions: TrendAlertCondition[];
  notificationChannels: string[];
  cooldownMinutes: number;
}

export interface TrendAlertCondition {
  type: "trend_reversal" | "threshold_cross" | "anomaly" | "rate_of_change";
  threshold: number;
  window: string; // e.g., "1h", "24h"
  severity: "info" | "warning" | "critical";
}

/** Trend monitoring service. */
export interface TrendMonitor {
  /** Analyze trends for a metric over a time window. */
  analyzeTrend(metricId: string, entityType: string, entityId: string, window: { start: string; end: string }): Promise<TrendAnalysis>;
  /** Detect anomalies in recent data. */
  detectAnomalies(metricId: string, entityType: string, entityId: string, sensitivity?: number): Promise<AnomalyDetection>;
  /** Get seasonal decomposition. */
  decomposeSeasonality(metricId: string, entityType: string, entityId: string): Promise<SeasonalDecomposition>;
  /** Register trend alert. */
  registerAlert(config: TrendAlertConfig): Promise<void>;
  /** Get active alerts. */
  getActiveAlerts(): Promise<TrendAlertConfig[]>;
}

/** Time series storage interface. */
export interface TimeSeriesStore {
  write(metricId: string, entityType: string, entityId: string, points: TimeSeriesPoint[]): Promise<void>;
  read(metricId: string, entityType: string, entityId: string, start: string, end: string): Promise<TimeSeriesPoint[]>;
  aggregate(metricId: string, entityType: string, entityId: string, granularity: string, start: string, end: string): Promise<TimeSeriesPoint[]>;
  delete(metricId: string, entityType: string, entityId: string, before: string): Promise<number>;
}