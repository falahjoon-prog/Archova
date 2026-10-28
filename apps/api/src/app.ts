import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import {
  createLogMessageSender,
  disabledMessageSender,
  type Database,
  type Logger,
  type MessageSender,
  type RedisClient,
} from '@archova/kernel';
import { FAKE_MODELS, type ModelProvider, type RasterizePage } from '@archova/mod-ai';
import type { EntitlementProvider } from '@archova/mod-billing';
import type { MalwareScanner, ObjectStore, TileUrls } from '@archova/mod-files';
import type { ApiConfig } from './config';
import { loadModules, type Modules } from './modules';
import { registerInternalOperations } from './internal';
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
  /** Signs drawing tile URLs; defaults to the in-memory signer (no CDN). */
  tiles?: TileUrls;
  entitlements?: EntitlementProvider;
  /** One-time codes and link invites; tests pass the in-memory sender, the default follows `API_MESSAGES`. */
  messages?: MessageSender;
  /** Tests inject a fake model provider with scripted responses. */
  aiProvider?: ModelProvider;
  /**
   * Renders a drawing page for the linework half of revision compare. None in the API image (no native canvas);
   * tests and a developer's machine pass one.
   */
  aiRasterizePage?: RasterizePage;
  /** Hands the loaded modules to the caller, e.g. tests that drive import commands (X49) directly. */
  onModules?: (modules: Modules) => void;
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

  if (config.internal.localLogin && config.env === 'production')
    deps.logger.warn(
      'API_STAFF_LOCAL_LOGIN=true: staff sign in with a password. Use only in the demo cell, not with real customer data.',
    );
  if (config.messages === 'log' && config.env === 'production')
    deps.logger.warn(
      'API_MESSAGES=log prints one-time codes and phone numbers to the log: demo cell with synthetic data only',
    );

  const modules = await loadModules(
    { database: deps.database, redis: deps.redis, logger: deps.logger },
    {
      identity: {
        issuer: config.jwtIssuer,
        audience: config.jwtIssuer,
        privateJwk: config.jwtPrivateJwk,
        webSignInUrl: config.webSignInUrl,
      },
      files: {
        store: deps.store,
        scanner: deps.scanner,
        ...(deps.tiles ? { tiles: deps.tiles } : {}),
      },
      messages:
        deps.messages ??
        (config.messages === 'log' ? createLogMessageSender(deps.logger) : disabledMessageSender),
      linkBaseUrl: config.linkBaseUrl,
      backoffice: {
        localLogin: config.internal.localLogin,
        soloCoolingOffHours: config.internal.soloCoolingOffHours,
      },
      ...(deps.entitlements ? { entitlements: deps.entitlements } : {}),
      ai: {
        ...(deps.aiRasterizePage ? { rasterizePage: deps.aiRasterizePage } : {}),
        config:
          config.ai.provider === 'bedrock'
            ? {
                provider: {
                  kind: 'bedrock',
                  region: config.ai.region,
                  ...(config.ai.endpoint ? { endpoint: config.ai.endpoint } : {}),
                  ...(config.ai.ocrEndpoint ? { ocrEndpoint: config.ai.ocrEndpoint } : {}),
                },
                models: config.ai.models,
                embedding: { model: config.ai.embeddingModel },
              }
            : { provider: { kind: 'fake' }, models: FAKE_MODELS },
        ...(deps.aiProvider ? { provider: deps.aiProvider } : {}),
      },
    },
  );

  deps.onModules?.(modules);

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
  registerInternalOperations(app, { config, backoffice: modules.backoffice });
  return app;
}
