import { loadAiConfig, type AiConfig } from '@archova/mod-ai';

export interface AiWorkerConfig {
  /** app_rw: tenant transactions, exactly like the API. */
  databaseUrl: string;
  /** The job Redis (Valkey). */
  redisUrl: string;
  /** Nova's settings, read by the same code as the API's so the two cannot disagree on region or models (X25). */
  ai: AiConfig;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing environment variable ${key}`);
  return v;
}

/** No `DATABASE_PLATFORM_URL`: the ai-worker has no relay and never reads across tenants. */
export function loadAiWorkerConfig(env: NodeJS.ProcessEnv = process.env): AiWorkerConfig {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: required(env, 'REDIS_URL'),
    ai: loadAiConfig(env),
  };
}
