/**
 * Output Schema Injection (Req #11).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Injects the agent's output schema (JSON Schema) into the prompt so the LLM
 * knows the exact output format required.
 */

import type { JsonSchema } from "../core/validation";

export interface OutputSchemaInjector {
  /** Inject the output schema into the prompt. */
  inject(schema: JsonSchema, options?: SchemaInjectionOptions): Promise<string>;
}

export interface SchemaInjectionOptions {
  /** Include a concrete example of valid output? */
  includeExample?: boolean;
  /** Max tokens for the schema section. */
  maxTokens?: number;
  /** Format: "schema_only" | "schema_plus_example" | "instructions_plus_schema". */
  format?: "schema_only" | "schema_plus_example" | "instructions_plus_schema";
}

export interface SchemaInjectionResult {
  content: string;
  tokens: number;
  truncated: boolean;
}