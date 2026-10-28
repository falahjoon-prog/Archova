export interface WorkerConfig {
  /** app_platform: the cross-tenant outbox relay only (migration 20261028150000). */
  platformDatabaseUrl: string;
  /** app_rw: tenant transactions for subscribers, exactly like the API. */
  databaseUrl: string;
  redisUrl: string;
  /** Object storage for file jobs; `none` leaves them unregistered (local runs without a bucket). */
  files: {
    store: 's3' | 'none';
    bucket: string;
    region: string;
    endpoint: string | undefined;
    credentials: { accessKeyId: string; secretAccessKey: string } | null;
  };
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
    files: {
      store: env.WORKER_FILES_STORE === 's3' ? 's3' : 'none',
      bucket: env.WORKER_FILES_BUCKET ?? 'archova-local-files',
      region: env.WORKER_FILES_REGION ?? 'ap-southeast-2',
      endpoint: env.WORKER_S3_ENDPOINT || undefined,
      credentials:
        env.WORKER_S3_ACCESS_KEY_ID && env.WORKER_S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.WORKER_S3_ACCESS_KEY_ID,
              secretAccessKey: env.WORKER_S3_SECRET_ACCESS_KEY,
            }
          : null,
    },
  };
}
