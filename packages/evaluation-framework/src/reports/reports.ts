/**
 * Evaluation Reports - Comprehensive evaluation reporting.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Timestamp, Json } from "../core/common";

/** Complete evaluation report. */
export interface EvaluationReport {
  /** Unique report ID. */
  reportId: string;
  /** Associated evaluation run. */
  evaluationId: string;
  /** Report title. */
  title: string;
  /** Executive summary. */
  executiveSummary: string;
  /** Report sections. */
  sections: ReportSection[];
  /** Appendices. */
  appendices: ReportAppendix[];
  /** Generated timestamp. */
  generatedAt: string;
  /** Report version. */
  version: string;
  /** Classification level. */
  classification: "internal" | "confidential" | "restricted";
}

export interface ReportSection {
  /** Section ID. */
  sectionId: string;
  /** Section title. */
  title: string;
  /** Section content (markdown). */
  content: string;
  /** Sub-sections. */
  subsections?: ReportSection[];
  /** Visualizations/charts. */
  visualizations?: Visualization[];
  /** Order in report. */
  order: number;
}

export interface ReportAppendix {
  /** Appendix ID. */
  appendixId: string;
  /** Title. */
  title: string;
  /** Content (can be raw data, charts, tables). */
  content: Json;
  /** Format. */
  format: "json" | "csv" | "markdown" | "table";
}

export interface Visualization {
  /** Visualization ID. */
  id: string;
  /** Type of visualization. */
  type: "line_chart" | "bar_chart" | "heatmap" | "scatter_plot" | "gauge" | "table" | "trend_line";
  /** Title. */
  title: string;
  /** Data for visualization. */
  data: any;
  /** Configuration options. */
  config?: Record<string, any>;
  /** Caption/description. */
  caption?: string;
}

/** Report template for standardized reports. */
export interface ReportTemplate {
  templateId: string;
  name: string;
  description: string;
  /** Sections included in this template. */
  sections: ReportSectionTemplate[];
  /** Default visualizations. */
  defaultVisualizations: string[];
  /** Variables that can be customized. */
  variables: TemplateVariable[];
}

export interface ReportSectionTemplate {
  sectionId: string;
  title: string;
  required: boolean;
  contentTemplate: string; // Template with variables
  conditional?: boolean;
  condition?: string; // Expression to determine inclusion
}

export interface TemplateVariable {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "list";
  description: string;
  required: boolean;
  defaultValue?: Json;
}

/** Report generation service. */
export interface ReportGenerator {
  /** Generate report from evaluation result. */
  generate(evaluationResult: any, templateId?: string, options?: ReportOptions): Promise<EvaluationReport>;

  /** Generate report from template with custom data. */
  generateFromTemplate(templateId: string, data: Json, options?: ReportOptions): Promise<EvaluationReport>;

  /** Export report in various formats. */
  export(report: EvaluationReport, format: "pdf" | "html" | "markdown" | "json"): Promise<Uint8Array | string>;

  /** List available templates. */
  listTemplates(): Promise<ReportTemplate[]>;
}

export interface ReportOptions {
  /** Include raw data in appendix. */
  includeRawData?: boolean;
  /** Include visualizations. */
  includeVisualizations?: boolean;
  /** Custom branding. */
  branding?: BrandingOptions;
  /** Language for report. */
  language?: string;
}

export interface BrandingOptions {
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  companyName?: string;
}

/** Standard report templates. */
export const STANDARD_REPORT_TEMPLATES: Record<string, any> = {
  "executive_summary": {
    templateId: "executive_summary",
    name: "Executive Summary Report",
    description: "High-level summary for leadership",
    sections: [
      { sectionId: "overview", title: "Overview", required: true, contentTemplate: "{{executiveSummary}}" },
      { sectionId: "key_metrics", title: "Key Metrics", required: true, contentTemplate: "{{metricsSummary}}" },
      { sectionId: "quality_gates", title: "Quality Gates", required: true, contentTemplate: "{{gateResults}}" },
      { sectionId: "recommendations", title: "Recommendations", required: true, contentTemplate: "{{recommendations}}" },
    ],
    defaultVisualizations: ["scorecard", "trend_chart", "gate_status"],
    variables: [
      { name: "period", type: "string", description: "Reporting period", required: true },
      { name: "entities", type: "list", description: "Entities evaluated", required: true },
    ],
  },
  "detailed_technical": {
    templateId: "detailed_technical",
    name: "Detailed Technical Report",
    description: "Comprehensive technical evaluation report",
    sections: [
      { sectionId: "overview", title: "Overview", required: true, contentTemplate: "{{executiveSummary}}" },
      { sectionId: "methodology", title: "Methodology", required: true, contentTemplate: "{{methodology}}" },
      { sectionId: "metrics", title: "Detailed Metrics", required: true, contentTemplate: "{{detailedMetrics}}" },
      { sectionId: "quality_gates", title: "Quality Gates", required: true, contentTemplate: "{{gateResults}}" },
      { sectionId: "benchmarks", title: "Benchmark Results", required: true, contentTemplate: "{{benchmarkResults}}" },
      { sectionId: "regression", title: "Regression Analysis", required: false, contentTemplate: "{{regressionResults}}" },
      { sectionId: "recommendations", title: "Recommendations", required: true, contentTemplate: "{{recommendations}}" },
    ],
    defaultVisualizations: ["scorecard", "trend_chart", "gate_status", "benchmark_comparison", "regression_chart"],
    variables: [
      { name: "period", type: "string", description: "Reporting period", required: true },
      { name: "entities", type: "list", description: "Entities evaluated", required: true },
      { name: "includeRegression", type: "boolean", description: "Include regression analysis", required: false, defaultValue: true },
    ],
  },
  "compliance_audit": {
    templateId: "compliance_audit",
    name: "Compliance Audit Report",
    description: "Regulatory compliance audit report",
    sections: [
      { sectionId: "overview", title: "Compliance Overview", required: true, contentTemplate: "{{complianceOverview}}" },
      { sectionId: "requirements", title: "Requirements Coverage", required: true, contentTemplate: "{{requirementsCoverage}}" },
      { sectionId: "findings", title: "Findings", required: true, contentTemplate: "{{findings}}" },
      { sectionId: "remediation", title: "Remediation Plan", required: true, contentTemplate: "{{remediationPlan}}" },
    ],
    defaultVisualizations: ["compliance_matrix", "risk_heatmap", "timeline"],
    variables: [
      { name: "standard", type: "string", description: "Compliance standard (SOC2, GDPR, etc.)", required: true },
      { name: "scope", type: "string", description: "Audit scope", required: true },
    ],
  },
  "incident_postmortem": {
    templateId: "incident_postmortem",
    name: "Incident Postmortem",
    description: "Post-incident analysis report",
    sections: [
      { sectionId: "summary", title: "Incident Summary", required: true, contentTemplate: "{{incidentSummary}}" },
      { sectionId: "timeline", title: "Timeline", required: true, contentTemplate: "{{timeline}}" },
      { sectionId: "root_cause", title: "Root Cause Analysis", required: true, contentTemplate: "{{rootCause}}" },
      { sectionId: "impact", title: "Impact Assessment", required: true, contentTemplate: "{{impactAssessment}}" },
      { sectionId: "action_items", title: "Action Items", required: true, contentTemplate: "{{actionItems}}" },
    ],
    defaultVisualizations: ["timeline_chart", "impact_chart"],
    variables: [
      { name: "incidentId", type: "string", description: "Incident identifier", required: true },
      { name: "severity", type: "string", description: "Incident severity", required: true },
    ],
  },
};