import { loadModules, type Modules } from '@archova/compose';
import {
  disabledMessageSender,
  type Database,
  type Logger,
  type TenantContext,
} from '@archova/kernel';
import { randomBytes } from 'node:crypto';
import type { ModelProvider } from '@archova/mod-ai';
import { createMemoryObjectStore, noScanner } from '@archova/mod-files';
import { vaultFromKey } from '@archova/mod-integrations';
import type { AiWorkerConfig } from './config';
import { indexContext, isOrgGone, type ReindexDeps } from './reindex';

/**
 * The modules, loaded as the API loads them, because Nova reads records through their module interfaces. What the
 * index job does not use is inert here: no files are read (a memory store), no one signs in (an ephemeral token key,
 * never shared with the API) and nothing is sent to anyone.
 */
export function loadAiWorkerModules(
  database: Database,
  logger: Logger,
  config: Pick<AiWorkerConfig, 'ai'>,
  provider?: ModelProvider,
): Promise<Modules> {
  return loadModules(
    { database, redis: null, logger },
    {
      identity: {
        issuer: 'archova-ai-worker',
        audience: 'archova-ai-worker',
        privateJwk: null,
        webSignInUrl: 'http://ai-worker.invalid',
      },
      files: { store: createMemoryObjectStore(), scanner: noScanner },
      messages: disabledMessageSender,
      linkBaseUrl: 'http://ai-worker.invalid',
      backoffice: { localLogin: false, soloCoolingOffHours: 24 },
      ai: { config: config.ai, ...(provider ? { provider } : {}) },
      // Webhooks are delivered by the default worker; here they can neither seal a secret nor send.
      webhooks: {
        vault: vaultFromKey(randomBytes(32).toString('base64')),
        transport: {
          send: async () => ({ status: null, error: 'webhooks are off in the ai-worker' }),
        },
      },
      accounting: {
        vault: vaultFromKey(randomBytes(32).toString('base64')),
        fetch: async () => new Response(null, { status: 503 }),
        redirectUri: 'http://ai-worker.invalid',
        credentials: { xero: null, myob: null },
      },
    },
  );
}

/** The parts of `ReindexDeps` that come from the loaded modules. */
export function reindexDepsFrom(
  database: Database,
  modules: Modules,
): Pick<ReindexDeps, 'ai' | 'entitlementsFor' | 'orgExists'> {
  const probe = (orgId: string): TenantContext =>
    indexContext(orgId, { plan: 'system', state: 'active', modules: [], limits: {} }, 'ai-org');
  return {
    ai: modules.ai.api,
    entitlementsFor: (orgId) => modules.billing.api.entitlements.forOrg(orgId),
    orgExists: (orgId) =>
      database
        .withTenantTx(probe(orgId), (scope) => modules.platform.api.getOrg(scope))
        .then(
          () => true,
          (err: unknown) => {
            if (isOrgGone(err)) return false;
            throw err;
          },
        ),
  };
}
