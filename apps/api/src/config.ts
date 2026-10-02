import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const list = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_DATABASE_URL: z.string().url(),
  API_DATABASE_POOL_MAX: z.coerce.number().int().default(10),
  API_REDIS_URL: z.string().url().optional(),
  API_APP_ORIGINS: list.default('http://localhost:3000'),
  API_PUBLIC_HOSTS: list.default('localhost:4000'),
  API_TRUST_PROXY: bool.default('false'),
  API_JWT_PRIVATE_JWK: z.string().optional(),
  API_JWT_ISSUER: z.string().optional(),
  API_WEB_SIGN_IN_URL: z.string().url().default('http://localhost:3000/login'),
  API_FILES_STORE: z.enum(['s3', 'memory']).default('memory'),
  API_FILES_BUCKET: z.string().default('archova-local-files'),
  API_FILES_REGION: z.string().default('ap-southeast-2'),
  API_S3_ENDPOINT: z.string().url().optional(),
  API_FILES_SCANNER: z.enum(['none']).default('none'),
  LOG_LEVEL: z.string().default('info'),
});

export type ApiConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(env);
  const appOrigins = e.API_APP_ORIGINS.map((o) => new URL(o).origin);
  const config = {
    env: e.NODE_ENV,
    port: e.API_PORT,
    host: e.API_HOST,
    databaseUrl: e.API_DATABASE_URL,
    databasePoolMax: e.API_DATABASE_POOL_MAX,
    redisUrl: e.API_REDIS_URL ?? null,
    appOrigins,
    appHosts: appOrigins.map((o) => new URL(o).host),
    publicHosts: e.API_PUBLIC_HOSTS,
    trustProxy: e.API_TRUST_PROXY,
    jwtPrivateJwk: e.API_JWT_PRIVATE_JWK ?? null,
    jwtIssuer: e.API_JWT_ISSUER ?? `https://${e.API_PUBLIC_HOSTS[0] ?? 'api.localhost'}`,
    webSignInUrl: e.API_WEB_SIGN_IN_URL,
    files: {
      store: e.API_FILES_STORE,
      bucket: e.API_FILES_BUCKET,
      region: e.API_FILES_REGION,
      endpoint: e.API_S3_ENDPOINT,
      scanner: e.API_FILES_SCANNER,
    },
    logLevel: e.LOG_LEVEL,
  };
  if (config.env === 'production') {
    const missing: string[] = [];
    if (!config.jwtPrivateJwk) missing.push('API_JWT_PRIVATE_JWK');
    if (!config.redisUrl) missing.push('API_REDIS_URL (sessions, revocation, idempotency)');
    if (config.files.store !== 's3') missing.push('API_FILES_STORE=s3');
    if (config.files.scanner === 'none')
      missing.push('a malware scanner (ClamAV in the files worker)');
    if (config.appOrigins.some((o) => !o.startsWith('https://')))
      missing.push('https API_APP_ORIGINS');
    if (missing.length)
      throw new Error(`Refusing to start in production without: ${missing.join(', ')}`);
  }
  return config;
}
