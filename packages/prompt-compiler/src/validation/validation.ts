/**
 * Prompt Validation (Req #14).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Validates the final assembled prompt before it's sent to the provider.
 */

import type { FinalPrompt } from "../sections/sections";
import type { JsonSchema } from "../core/validation";

export type ValidationErrorCode =
  | "OVER_BUDGET"
  | "MISSING_REQUIRED_SECTION"
  | "SCHEMA_INVALID"
  | "SAFETY_VIOLATION"
  | "MISSING_OUTPUT_SCHEMA"
  | "INVALID_TEMPLATE_VERSION"
  | "SECTION_EMPTY";

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
  section?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  section?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface PromptValidator {
  /** Validate the final assembled prompt. */
  validate(prompt: FinalPrompt): ValidationResult;

  /** Quick checks without full validation. */
  quickValidate(prompt: string): { valid: boolean; criticalErrors: string[] };
}

export interface ValidationConfig {
  /** Strict mode: warnings become errors. */
  strict?: boolean;
  /** Custom schema validators. */
  customValidators?: Array<(schema: any) => Promise<ValidationError[]>>;
}