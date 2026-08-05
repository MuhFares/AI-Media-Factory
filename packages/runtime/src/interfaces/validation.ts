/**
 * Schema validation contracts (JSON Schema draft-07).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Json } from "./common";

/** Opaque JSON Schema document (draft-07). */
export type JsonSchema = { readonly [key: string]: Json };

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/** Validates any payload against a JSON Schema; supports oneOf fan-in schemas. */
export interface SchemaValidator {
  validate(schema: JsonSchema, data: Json): ValidationResult;
}
