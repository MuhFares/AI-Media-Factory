/** Shared test utilities for the database package integration tests. */

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";