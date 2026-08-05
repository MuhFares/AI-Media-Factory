/**
 * Shared primitive types for the provider layer.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

/** Vendor identifier. Open-ended by design (future providers, req #20). */
export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "deepseek"
  | "mistral"
  | string;

/** A concrete vendor model id (e.g. resolved from a logical tier). */
export type ModelId = string;

/** JSON value. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
