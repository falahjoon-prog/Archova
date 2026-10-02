import { bootstrapDatabase, lintSchema, migrate } from '@archova/tools/db';

// Integration tests run against a real Postgres 16 with RLS on, connecting as app_rw (backend 01 §7).
export const TEST_DB_NAME = process.env.TEST_DB_NAME ?? 'archova_test';
const host = process.env.DB_HOST ?? 'localhost';
const port = process.env.DB_PORT ?? '5432';

export const testAdminUrl = () =>
  process.env.TEST_DB_ADMIN_URL ?? `postgres://postgres:postgres@${host}:${port}/postgres`;
export const testAppUrl = () => `postgres://app_rw:app_rw@${host}:${port}/${TEST_DB_NAME}`;
export const testMigratorUrl = () =>
  `postgres://app_migrator:app_migrator@${host}:${port}/${TEST_DB_NAME}`;
export const testRedisUrl = () => process.env.TEST_REDIS_URL ?? null;

/** Vitest globalSetup: recreate the test database, migrate it and run the RLS catalog lint. */
export async function prepareTestDatabase() {
  await bootstrapDatabase(testAdminUrl(), TEST_DB_NAME, { reset: true });
  await migrate(testMigratorUrl(), () => undefined);
  const problems = await lintSchema(testMigratorUrl());
  if (problems.length) throw new Error(`RLS lint failed:\n${problems.join('\n')}`);
}
