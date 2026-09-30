export function assertIsolatedE2eDatabase(e2eDatabaseUrl, productionDatabaseUrl) {
  if (!e2eDatabaseUrl || e2eDatabaseUrl === productionDatabaseUrl) {
    throw new Error("E2E_DATABASE_URL must not reference DATABASE_URL when destructive cleanup is enabled");
  }
}
