import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Database, Logger, RedisClient } from '@archova/kernel';
import { FAKE_MODELS, type ModelProvider } from '@archova/mod-ai';
import type { EntitlementProvider } from '@archova/mod-billing';
import type { MalwareScanner, ObjectStore } from '@archova/mod-files';
import type { ApiConfig } from './config';
import { loadModules } from './modules';
import { registerOperations } from './pipeline';
import { idempotencyStore } from './plugins/idempotency';
import { registerProblemHandler } from './plugins/problem';

export interface AppDeps {
  config: ApiConfig;
  database: Database;
  redis: RedisClient | null;
  logger: Logger;
  store: ObjectStore;
  scanner: MalwareScanner;
  entitlements?: EntitlementProvider;
  /** Tests inject a fake model provider with scripted responses. */
  aiProvider?: ModelProvider;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    genReqId: () => crypto.randomUUID(),
  });
  await app.register(cookie);
  await app.register(formbody);
  registerProblemHandler(app);

  app.addHook('onSend', async (_req, reply) => {
    void reply.header('x-content-type-options', 'nosniff');
    void reply.header('referrer-policy', 'no-referrer');
  });

  const modules = await loadModules(
    { database: deps.database, redis: deps.redis, logger: deps.logger },
    {
      identity: {
        issuer: config.jwtIssuer,
        audience: config.jwtIssuer,
        privateJwk: config.jwtPrivateJwk,
        webSignInUrl: config.webSignInUrl,
      },
      files: { store: deps.store, scanner: deps.scanner },
      ...(deps.entitlements ? { entitlements: deps.entitlements } : {}),
      ai: {
        config:
          config.ai.provider === 'bedrock'
            ? {
                provider: {
                  kind: 'bedrock',
                  region: config.ai.region,
                  ...(config.ai.endpoint ? { endpoint: config.ai.endpoint } : {}),
                },
                models: config.ai.models,
              }
            : { provider: { kind: 'fake' }, models: FAKE_MODELS },
        ...(deps.aiProvider ? { provider: deps.aiProvider } : {}),
      },
    },
  );

  // Load balancer health checks; outside the contract and the host rules.
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      await deps.database.db.execute(sql`select 1`);
      if (deps.redis) await deps.redis.ping();
      return { status: 'ok' };
    } catch {
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  registerOperations(app, {
    config,
    modules,
    routes: modules.routes,
    idempotency: deps.redis ? idempotencyStore(deps.redis) : null,
  });
  return app;
}
