/**
 * Env-driven adapter configuration.
 *
 * Adapters accept an injected plain config object (deterministic, unit-testable)
 * and are constructed from env via `fromEnv()` factories. Required credentials
 * are validated eagerly at construction time and throw a deterministic
 * ProviderConfigurationError naming exactly which variable is missing.
 */

import { providerConfigError } from "./errors.js";

const isPresent = (value: string | undefined): boolean =>
  value !== undefined && value.trim().length > 0;

export function requiredEnv(providerId: string, name: string, purpose: string): string {
  const value = process.env[name];
  if (!isPresent(value)) {
    throw providerConfigError(
      providerId,
      `Missing required environment variable '${name}' (${purpose}). Set it before constructing the ${providerId} adapter.`,
    );
  }
  return (value as string).trim();
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return isPresent(value) ? (value as string).trim() : fallback;
}

export function envNumber(providerId: string, name: string, fallback: number): number {
  const value = process.env[name];
  if (!isPresent(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw providerConfigError(providerId, `Environment variable '${name}' must be a number, got '${value}'.`);
  }
  return parsed;
}

export function envBoolean(providerId: string, name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!isPresent(value)) return fallback;
  const normalized = (value as string).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw providerConfigError(providerId, `Environment variable '${name}' must be a boolean, got '${value}'.`);
}

export function assertPositive(providerId: string, value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw providerConfigError(providerId, `${what} must be a positive number, got ${value}.`);
  }
}

export function assertNonNegative(providerId: string, value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw providerConfigError(providerId, `${what} must be a non-negative number, got ${value}.`);
  }
}