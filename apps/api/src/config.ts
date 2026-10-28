import { z } from 'zod';
import { assertAustralianModelId, isAustralianRegion } from '@archova/mod-ai';

// Zod 4's .default() skips the transform and returns the value as-is; .prefault() feeds it through like zod 3 did.
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
  API_APP_ORIGINS: list.prefault('http://localhost:3000'),
  API_PUBLIC_HOSTS: list.prefault('localhost:4000'),
  API_TRUST_PROXY: bool.prefault('false'),
  API_JWT_PRIVATE_JWK: z.string().optional(),
  API_JWT_ISSUER: z.string().optional(),
  API_WEB_SIGN_IN_URL: z.string().url().default('http://localhost:3000/login'),
  API_FILES_STORE: z.enum(['s3', 'memory']).default('memory'),
  API_FILES_BUCKET: z.string().default('archova-local-files'),
  API_FILES_REGION: z.string().default('ap-southeast-2'),
  API_S3_ENDPOINT: z.string().url().optional(),
  // Keys for S3-compatible storage outside AWS (the Linode option), where the AWS credentials (Roles Anywhere) are
  // for Bedrock only. Unset on AWS, which uses the task role.
  API_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  API_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Malware scanning (security-licensing/09 §4): GuardDuty Malware Protection for S3 on AWS, ClamAV elsewhere
  // (the Linode option, infrastructure/09).
  API_FILES_SCANNER: z.enum(['none', 'guardduty', 'clamav']).default('none'),
  API_CLAMAV_HOST: z.string().default('clamav'),
  API_CLAMAV_PORT: z.coerce.number().int().default(3310),
  // Until apps/worker scans in the background, the scan holds the upload's transaction, so keep this short; slower
  // scans are retried on later reads and fail closed after SCAN_TIMEOUT_MS.
  API_CLAMAV_TIMEOUT_MS: z.coerce.number().int().default(30_000),
  // Nova (ai/02): Bedrock in Australia when deployed; the fake provider locally and in tests.
  API_AI_PROVIDER: z.enum(['fake', 'bedrock']).default('fake'),
  API_AI_REGION: z.string().default('ap-southeast-2'),
  API_AI_BEDROCK_ENDPOINT: z.string().url().optional(),
  // OCR of scanned pages: Textract in the same Australian region (ai/02), through its VPC endpoint when set.
  API_AI_TEXTRACT_ENDPOINT: z.string().url().optional(),
  API_AI_MODEL_FAST: z.string().optional(),
  API_AI_MODEL_STANDARD: z.string().optional(),
  API_AI_MODEL_ADVANCED: z.string().optional(),
  // Ask Nova embeddings: Titan Text Embeddings V2 in Sydney (ai/02 §6), 1024 dimensions.
  API_AI_MODEL_EMBEDDING: z.string().default('amazon.titan-embed-text-v2:0'),
  // One-time codes and link invites (security-licensing/11). `log` writes them to the log instead of sending: local
  // and demo only. SES and AWS End User Messaging SMS in Sydney arrive with the infrastructure work.
  API_MESSAGES: z.enum(['log', 'disabled']).default('disabled'),
  // The web origin access links point at; defaults to the first app origin.
  API_LINK_BASE_URL: z.string().url().optional(),
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
      credentials:
        e.API_S3_ACCESS_KEY_ID && e.API_S3_SECRET_ACCESS_KEY
          ? { accessKeyId: e.API_S3_ACCESS_KEY_ID, secretAccessKey: e.API_S3_SECRET_ACCESS_KEY }
          : null,
      scanner: e.API_FILES_SCANNER,
      clamav: {
        host: e.API_CLAMAV_HOST,
        port: e.API_CLAMAV_PORT,
        timeoutMs: e.API_CLAMAV_TIMEOUT_MS,
      },
    },
    ai: {
      provider: e.API_AI_PROVIDER,
      region: e.API_AI_REGION,
      endpoint: e.API_AI_BEDROCK_ENDPOINT,
      ocrEndpoint: e.API_AI_TEXTRACT_ENDPOINT,
      models: {
        fast: e.API_AI_MODEL_FAST ?? '',
        standard: e.API_AI_MODEL_STANDARD ?? '',
        advanced: e.API_AI_MODEL_ADVANCED ?? '',
      },
      embeddingModel: e.API_AI_MODEL_EMBEDDING,
    },
    messages: e.API_MESSAGES,
    linkBaseUrl: new URL(e.API_LINK_BASE_URL ?? appOrigins[0] ?? 'http://localhost:3000').origin,
    logLevel: e.LOG_LEVEL,
  };
  if (config.ai.provider === 'bedrock') {
    const unset = (['fast', 'standard', 'advanced'] as const).filter((t) => !config.ai.models[t]);
    if (unset.length)
      throw new Error(
        `API_AI_PROVIDER=bedrock needs model ids for: ${unset.map((t) => `API_AI_MODEL_${t.toUpperCase()}`).join(', ')}`,
      );
    if (!isAustralianRegion(config.ai.region))
      throw new Error(`API_AI_REGION must be an Australian region (X25), not ${config.ai.region}`);
    for (const t of ['fast', 'standard', 'advanced'] as const)
      assertAustralianModelId(config.ai.models[t]);
    assertAustralianModelId(config.ai.embeddingModel);
  }
  if (Boolean(e.API_S3_ACCESS_KEY_ID) !== Boolean(e.API_S3_SECRET_ACCESS_KEY))
    throw new Error('Set both API_S3_ACCESS_KEY_ID and API_S3_SECRET_ACCESS_KEY, or neither');
  if (config.files.scanner === 'guardduty' && config.files.store !== 's3')
    throw new Error(
      'API_FILES_SCANNER=guardduty reads S3 object tags, so it needs API_FILES_STORE=s3',
    );
  if (config.files.scanner === 'clamav' && config.files.store !== 's3')
    throw new Error(
      'API_FILES_SCANNER=clamav reads uploads from storage, so it needs API_FILES_STORE=s3',
    );
  if (config.env === 'production') {
    const missing: string[] = [];
    if (!config.jwtPrivateJwk) missing.push('API_JWT_PRIVATE_JWK');
    if (!config.redisUrl) missing.push('API_REDIS_URL (sessions, revocation, idempotency)');
    if (config.files.store !== 's3') missing.push('API_FILES_STORE=s3');
    if (config.files.scanner === 'none') missing.push('API_FILES_SCANNER=guardduty or clamav');
    if (config.ai.provider !== 'bedrock') missing.push('API_AI_PROVIDER=bedrock (Nova)');
    if (config.appOrigins.some((o) => !o.startsWith('https://')))
      missing.push('https API_APP_ORIGINS');
    if (missing.length)
      throw new Error(`Refusing to start in production without: ${missing.join(', ')}`);
  }
  return config;
}
