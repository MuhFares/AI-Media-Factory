/**
 * @ai-media-factory/finance-agent — public contract surface.
 */

export type {
  FinanceDependencies,
  FinanceInput,
  FinanceSourceArtifact,
  FinancialData,
  FinancialReport,
  FinanceStatus,
  FinanceConfig,
  CpaType,
  FinanceExecutionInput,
  FinanceExecutionOutput,
} from "./types.js";

export {
  FinanceAgent,
  createFinanceAgent,
  DEFAULT_FINANCE_SYSTEM_PROMPT,
} from "./finance-agent.js";