/**
 * Program-3 quarantine for historical direct runners.
 * These scripts are evidence/debugging tools, not production entry points.
 * They may run only with an explicit override against a database whose name
 * is unmistakably test-scoped. Credentials are never inspected or printed.
 */
export function assertLegacyUnsafeRunnerAllowed(name, env = process.env) {
  if (env.AMF_ALLOW_LEGACY_UNSAFE_RUNNER !== "YES") {
    throw new Error(`LEGACY_UNSAFE_RUNNER_QUARANTINED:${name}:USE_CANONICAL_RECOVERY_FRAMEWORK`);
  }
  const target = env.TEST_DATABASE_URL ?? env.DATABASE_URL;
  if (!target) throw new Error(`LEGACY_UNSAFE_RUNNER_DATABASE_REQUIRED:${name}`);
  let database;
  try { database = new URL(target).pathname.replace(/^\//, ""); }
  catch { throw new Error(`LEGACY_UNSAFE_RUNNER_DATABASE_INVALID:${name}`); }
  if (!/(^|[_-])test($|[_-])/i.test(database)) {
    throw new Error(`LEGACY_UNSAFE_RUNNER_PRODUCTION_DATABASE_FORBIDDEN:${name}`);
  }
}
