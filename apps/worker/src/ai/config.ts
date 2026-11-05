import { loadAiConfig, type AiConfig } from '@archova/mod-ai';

/** Xero and MYOB pushes, which run here because this is the process that loads the modules. */
export interface AccountingWorkerConfig {
  /** The API's key (`API_ACCOUNTING_SECRET_KEY`): the API sealed the tokens this worker opens. */
  secretKey: string;
  /** The web origin; only used to build the redirect address the API registers, never called from here. */
  linkBaseUrl: string;
  credentials: {
    xero: { clientId: string; clientSecret: string } | null;
    myob: { clientId: string; clientSecret: string } | null;
  };
  /** SharePoint and Drive folder links publish from here too, with the API's registrations. */
  folders: {
    m365: { clientId: string; privateKeyPem: string; thumbprintHex: string } | null;
    google: { clientId: string; clientSecret: string } | null;
  };
}

export interface AiWorkerConfig {
  /** app_rw: tenant transactions, exactly like the API. */
  databaseUrl: string;
  /** The job Redis (Valkey). */
  redisUrl: string;
  /** Nova's settings, read by the same code as the API's so the two cannot disagree on region or models (X25). */
  ai: AiConfig;
  /** Null leaves bills and invoices unpushed: no key, or no app credentials for either provider. */
  accounting: AccountingWorkerConfig | null;
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
    accounting: accountingConfig(env),
  };
}

/** The API's variables with a WORKER_ prefix; the key is the accounting key the API also uses to seal tokens. */
function accountingConfig(env: NodeJS.ProcessEnv): AccountingWorkerConfig | null {
  const pair = (p: 'XERO' | 'MYOB' | 'GOOGLE') => {
    const clientId = env[`WORKER_${p}_CLIENT_ID`];
    const clientSecret = env[`WORKER_${p}_CLIENT_SECRET`];
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  };
  const credentials = { xero: pair('XERO'), myob: pair('MYOB') };
  const folders = {
    m365:
      env.WORKER_M365_CLIENT_ID &&
      env.WORKER_M365_PRIVATE_KEY_PEM &&
      env.WORKER_M365_CERT_THUMBPRINT
        ? {
            clientId: env.WORKER_M365_CLIENT_ID,
            privateKeyPem: env.WORKER_M365_PRIVATE_KEY_PEM.replace(/\\n/g, '\n'),
            thumbprintHex: env.WORKER_M365_CERT_THUMBPRINT,
          }
        : null,
    google: pair('GOOGLE'),
  };
  const secretKey = env.WORKER_ACCOUNTING_SECRET_KEY;
  if (!secretKey || (!credentials.xero && !credentials.myob && !folders.m365 && !folders.google))
    return null;
  return {
    secretKey,
    linkBaseUrl: env.WORKER_LINK_BASE_URL ?? 'http://localhost:3007',
    credentials,
    folders,
  };
}
