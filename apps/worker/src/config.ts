export interface WorkerConfig {
  /** app_platform: the cross-tenant outbox relay only (migration 20261028150000). */
  platformDatabaseUrl: string;
  /** app_rw: tenant transactions for subscribers, exactly like the API. */
  databaseUrl: string;
  redisUrl: string;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing environment variable ${key}`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    platformDatabaseUrl: required(env, 'DATABASE_PLATFORM_URL'),
    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: required(env, 'REDIS_URL'),
  };
}
