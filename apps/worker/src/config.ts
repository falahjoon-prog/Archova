export interface WorkerConfig {
  /** app_platform: the cross-tenant outbox relay only (migration 20261028150000). */
  platformDatabaseUrl: string;
  /** app_rw: tenant transactions for subscribers, exactly like the API. */
  databaseUrl: string;
  redisUrl: string;
  /** 32 bytes, base64: opens the webhook signing secrets the API sealed (same key as API_WEBHOOK_SECRET_KEY). */
  webhookSecretKey: string | null;
  /** Object storage for file jobs; `none` leaves them unregistered (local runs without a bucket). */
  /** `ses` sends mail through Amazon SES in `region`, `smtp` through the domain's mail host; anything else only logs. */
  email: {
    provider: 'ses' | 'smtp' | 'log';
    /** Set when the provider is `smtp`. The password is a secret and is never logged. */
    smtp: { host: string; port: number; user: string; pass: string } | null;
    region: string;
    from: string;
    replyTo: string | undefined;
    /** Base URL of the web app, for links in emails. */
    appBaseUrl: string;
  };
  /** RFC 3161 authority (https) for sealed claim evidence; unset leaves timestamping off. */
  evidenceTimestampUrl: string | null;
  /** PEM file of the authority's pinned certificates (root and any intermediates); required with the URL. */
  evidenceTimestampCaFile: string | null;
  /**
   * The worker's own Ed25519 key (its own id, never a copy of the API's key) to sign send proofs. Add its public key to
   * the API's verification keyring. Unset leaves send proofs unsigned (still hashed and timestamped).
   */
  evidenceSigning: { keyId: string; privateKeyPem: string } | null;
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

/**
 * `WORKER_ROLE=ai` is the ai-worker, which runs `dist/ai.js` (`src/ai.ts`) from its own image; the relay, dispatcher and
 * scheduled jobs run only in `src/main.ts`, and refuse to start with the ai role so the two are never mixed up.
 */
export function workerRole(env: NodeJS.ProcessEnv = process.env): 'default' | 'ai' {
  const role = env.WORKER_ROLE ?? 'default';
  if (role !== 'default' && role !== 'ai') throw new Error(`Unknown WORKER_ROLE ${role}`);
  return role;
}

/** What the default worker (relay, dispatcher, scheduled jobs) reads. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    platformDatabaseUrl: required(env, 'DATABASE_PLATFORM_URL'),
    databaseUrl: required(env, 'DATABASE_URL'),
    redisUrl: required(env, 'REDIS_URL'),
    webhookSecretKey: env.WORKER_WEBHOOK_SECRET_KEY || null,
    email: {
      provider:
        env.WORKER_EMAIL_PROVIDER === 'ses'
          ? 'ses'
          : env.WORKER_EMAIL_PROVIDER === 'smtp'
            ? 'smtp'
            : 'log',
      smtp:
        env.WORKER_EMAIL_PROVIDER === 'smtp'
          ? {
              host: required(env, 'WORKER_SMTP_HOST'),
              port: Number(env.WORKER_SMTP_PORT ?? 465),
              user: required(env, 'WORKER_SMTP_USER'),
              pass: required(env, 'WORKER_SMTP_PASS'),
            }
          : null,
      region: env.WORKER_EMAIL_REGION ?? 'ap-southeast-2',
      from:
        env.WORKER_EMAIL_FROM ??
        (env.WORKER_EMAIL_PROVIDER === 'smtp' && env.WORKER_SMTP_USER
          ? `Archova <${env.WORKER_SMTP_USER}>`
          : 'Archova <no-reply@archova.com.au>'),
      replyTo: env.WORKER_EMAIL_REPLY_TO || undefined,
      appBaseUrl: env.WORKER_APP_BASE_URL ?? 'https://app.archova.com.au',
    },
    evidenceTimestampUrl: env.WORKER_EVIDENCE_TSA_URL || null,
    evidenceTimestampCaFile: env.WORKER_EVIDENCE_TSA_CA_FILE || null,
    evidenceSigning: env.WORKER_EVIDENCE_SIGNING_KEY
      ? {
          keyId: required(env, 'WORKER_EVIDENCE_SIGNING_KEY_ID'),
          privateKeyPem: env.WORKER_EVIDENCE_SIGNING_KEY.replaceAll('\\n', '\n'),
        }
      : null,
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
