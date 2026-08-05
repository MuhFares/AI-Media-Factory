# Reports

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `reports.ts` | `EvaluationReport`, `ReportSection`, `ReportAppendix`, `Visualization`, `ReportTemplate`, `ReportGenerator`, `STANDARD_REPORT_TEMPLATES` | #10 |

4 standard templates: `executive_summary` (for leadership), `detailed_technical` (for engineering), `compliance_audit` (for governance), `incident_postmortem` (for incidents). `ReportGenerator` exports to PDF/HTML/Markdown/JSON.