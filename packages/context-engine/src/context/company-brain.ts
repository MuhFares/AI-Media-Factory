/**
 * Company Brain Section.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface CompanyBrainSection {
  vision: string;
  mission: string;
  values: string[];
  northStar: NorthStarMetric;
  decisionFramework: string;
  kpis: string;
  brandGuidelines: string;
  tokens: number;
}

export interface NorthStarMetric {
  name: string;
  formula: string;
  drivers: string[];
  currentValue: number;
  targetValue: number;
}