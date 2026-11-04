import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { operations, type OperationDef, type OperationId } from '@archova/contracts';
import { CORE_MODULES, decodeId } from '@archova/domain';
import {
  AppError,
  runWithRequestContext,
  type HandlerInput,
  type HandlerResult,
  type Principal,
  type RouteTable,
  type FlagReader,
  type TenantContext,
} from '@archova/kernel';
import { CSRF_COOKIE, SESSION_COOKIE, requiredScope, scopeAllows } from '@archova/mod-identity';
import { isDrainToken } from '@archova/mod-sync';
import type { ApiConfig } from './config';
import type { Modules } from '@archova/compose';
import type { IdempotencyStore } from './plugins/idempotency';
import { tighter, type ApiRateLimiter } from './plugins/rate-limit';
import { clientIp, safeEqualStrings } from './util';

type Surface = 'app' | 'api';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The request pipeline from backend 02 §1, applied to every operation in the OpenAPI contract:
 * requestContext → authenticate (+CSRF) → validate → tenant → entitlement → permission → idempotency → handler.
 * Rate limiting is added with the edge/WAF work (infrastructure 04) and per-plan limits from billing.
 */
export function registerOperations(
  app: FastifyInstance,
  deps: {
    config: ApiConfig;
    modules: Modules;
    routes: RouteTable;
    idempotency: IdempotencyStore | null;
    rateLimiter: ApiRateLimiter | null;
  },
) {
  const { config, modules, routes, idempotency, rateLimiter } = deps;

  const missing = (Object.keys(operations) as OperationId[]).filter((id) => !routes[id]);
  if (missing.length) throw new Error(`Operations without a handler: ${missing.join(', ')}`);
  for (const [id, def] of Object.entries(operations) as Array<[OperationId, OperationDef]>) {
    if (!def.module)
      throw new Error(`Operation ${id} has no x-module; every route belongs to a module`);
  }

  function surfaceOf(req: FastifyRequest): Surface | null {
    const host = req.host.toLowerCase();
    if (config.appHosts.includes(host)) return 'app';
    if (config.publicHosts.includes(host)) return 'api';
    return null;
  }

  /** ADR-0004: cookies only on the app origin, bearer only on the API origin. */
  async function authenticate(
    req: FastifyRequest,
    surface: Surface,
  ): Promise<{ principal: Principal | null; viaCookie: boolean }> {
    const authz = req.headers.authorization;
    if (surface === 'app') {
      if (authz)
        throw new AppError(
          'auth.wrong_origin_credential',
          'Use the session cookie on this origin.',
        );
      const token = req.cookies[SESSION_COOKIE];
      if (!token) return { principal: null, viaCookie: false };
      const principal = await modules.identity.api.resolveSessionToken(token);
      return { principal, viaCookie: Boolean(principal) };
    }
    if (!authz) return { principal: null, viaCookie: false };
    const m = /^Bearer\s+(\S+)$/i.exec(authz);
    if (!m) throw new AppError('auth.unauthenticated', 'Malformed Authorization header.');
    // Personal access tokens work in one org, so the URL's org is needed to find them.
    const urlOrg = (req.params as { orgId?: string } | undefined)?.orgId;
    const principal = await modules.identity.api.authenticateBearer(
      m[1]!,
      urlOrg ? decodeId('org', urlOrg) : null,
      clientIp(req, config.clientIpHops),
    );
    if (!principal)
      throw new AppError(
        'auth.session_revoked',
        'The access token is invalid, expired or revoked.',
      );
    return { principal, viaCookie: false };
  }

  /** The drain-grant token in a Bearer header, or null; the `dg_` prefix keeps it apart from access tokens. */
  function drainTokenOf(req: FastifyRequest): string | null {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    return m && isDrainToken(m[1]!) ? m[1]! : null;
  }

  /** ADR-0004 §5: Origin check on every unsafe browser request, plus double-submit token when a session is used. */
  function checkCsrf(req: FastifyRequest, surface: Surface, viaCookie: boolean) {
    if (surface !== 'app' || !UNSAFE.has(req.method)) return;
    const origin = req.headers.origin;
    if (!origin || !config.appOrigins.includes(origin))
      throw new AppError('auth.csrf_failed', 'Cross-site request blocked.');
    if (!viaCookie) return;
    const cookie = req.cookies[CSRF_COOKIE];
    const header = req.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || !safeEqualStrings(cookie, header)) {
      throw new AppError('auth.csrf_failed', 'Missing or invalid CSRF token.');
    }
  }

  function parse<T extends z.ZodTypeAny | null>(
    schema: T,
    value: unknown,
    notFoundOnFail: boolean,
  ) {
    if (!schema) return {};
    const r = schema.safeParse(value ?? {});
    if (r.success) return r.data as unknown;
    if (notFoundOnFail) throw new AppError('not_found');
    throw r.error;
  }

  async function resolveTenant(
    orgIdParam: string,
    principal: Principal,
    requestId: string,
  ): Promise<TenantContext> {
    const orgId = decodeId('org', orgIdParam);
    if (!orgId) throw new AppError('org.not_found');
    const access = await modules.platform.api.resolveTenantAccess(
      orgId,
      principal.userId,
      requestId,
    );
    if (!access) throw new AppError('org.not_found');
    const entitlements = await modules.billing.api.entitlements.forOrg(orgId);
    // Evaluated lazily and at most once per key per request, so routes without a flag pay nothing.
    const seen = new Map<string, Promise<boolean>>();
    const flags: FlagReader = {
      isOn: (key) => {
        let hit = seen.get(key);
        if (!hit) {
          hit = modules.backoffice.api.flags.isOn(key, orgId);
          seen.set(key, hit);
        }
        return hit;
      },
    };
    return {
      orgId,
      userId: principal.userId,
      principalType: access.principalType,
      orgRole: access.orgRole,
      entitlements,
      flags,
      requestId,
    };
  }

  /**
   * Personal access tokens (integrations/06 §2): one org, public operations only, and only within the token's scopes.
   * The owner's own permissions are still checked afterwards, so a token never does more than its owner.
   */
  function checkApiToken(
    operationId: string,
    def: OperationDef,
    token: NonNullable<Principal['apiToken']>,
    params: Record<string, string>,
  ) {
    if (def.internal)
      throw new AppError('api_token.not_allowed', 'Tokens cannot call this endpoint.');
    const needed = requiredScope(operationId, def.method);
    if (!needed) throw new AppError('api_token.not_allowed', 'Tokens cannot call this endpoint.');
    if (decodeId('org', params.orgId ?? '') !== token.orgId) throw new AppError('org.not_found');
    if (!scopeAllows(token.scopes, needed))
      throw new AppError(
        'api_token.scope_missing',
        `This token needs the ${needed} scope.`,
        undefined,
        {
          scope: needed,
        },
      );
  }

  /**
   * Token traffic counts against the plan's limits: the org's `limit.api_rpm` (default from config) shared by all its
   * tokens, and half of that for any one token. First-party web and mobile traffic is not counted.
   */
  async function limitRate(
    reply: FastifyReply,
    token: NonNullable<Principal['apiToken']>,
    tenant: TenantContext,
  ) {
    if (!rateLimiter) return;
    const orgLimit = tenant.entitlements.limits['limit.api_rpm'] ?? config.apiRateLimitOrgRpm;
    const byToken = await rateLimiter.hit(
      tenant.orgId,
      `token:${token.id}`,
      Math.max(1, Math.ceil(orgLimit / 2)),
    );
    const byOrg = await rateLimiter.hit(tenant.orgId, 'org', orgLimit);
    const shown = tighter(byToken, byOrg);
    void reply.header('ratelimit-limit', String(shown.limit));
    void reply.header('ratelimit-remaining', String(shown.remaining));
    void reply.header('ratelimit-reset', String(shown.resetS));
    const over = [byToken, byOrg].find((d) => !d.allowed);
    if (over) {
      void reply.header('retry-after', String(over.resetS));
      throw new AppError('rate_limited', 'Too many requests. Slow down and retry after a moment.');
    }
  }

  function checkEntitlement(
    def: OperationDef,
    tenant: TenantContext,
    method: string,
    operationId: OperationId,
  ) {
    const module = def.module!;
    if (
      !(CORE_MODULES as readonly string[]).includes(module) &&
      module !== 'billing' &&
      !tenant.entitlements.modules.includes(module)
    ) {
      throw new AppError(
        'entitlement-required',
        'Your plan does not include this feature.',
        undefined,
        { module },
      );
    }
    const state = tenant.entitlements.state;
    if (
      (state === 'read_only' || state === 'cancelled') &&
      UNSAFE.has(method) &&
      module !== 'billing' &&
      // Withdrawing consent for support access must work however the account stands.
      operationId !== 'revokeSupportAccessGrant'
    ) {
      throw new AppError(
        'org.read_only',
        'This organisation is read-only. An owner can update billing to restore access.',
      );
    }
  }

  function send(reply: FastifyReply, result: HandlerResult) {
    for (const c of result.setCookies ?? []) {
      void reply.setCookie(c.name, c.value, {
        path: '/',
        secure: true,
        httpOnly: c.httpOnly,
        sameSite: 'lax',
        ...(c.maxAgeSeconds !== null ? { maxAge: c.maxAgeSeconds } : {}),
      });
    }
    for (const name of result.clearCookies ?? [])
      void reply.clearCookie(name, { path: '/', secure: true, sameSite: 'lax' });
    for (const [k, v] of Object.entries(result.headers ?? {})) void reply.header(k, v);
    if (result.redirect) return reply.redirect(result.redirect, result.status === 303 ? 303 : 302);
    void reply.status(result.status);
    return result.body === undefined ? reply.send() : reply.send(result.body);
  }

  for (const [operationId, def] of Object.entries(operations) as Array<
    [OperationId, OperationDef]
  >) {
    const handler = routes[operationId] as unknown as (
      input: HandlerInput<OperationId>,
    ) => Promise<HandlerResult>;
    app.route({
      method: def.method,
      url: def.path.replace(/\{(\w+)\}/g, ':$1'),
      handler: async (req, reply) => {
        const requestId =
          (req.headers['x-request-id'] as string | undefined)?.slice(0, 100) ?? randomUUID();
        void reply.header('x-request-id', requestId);
        void reply.header('cache-control', 'no-store');
        const ctx = {
          requestId,
          traceId: null,
          principal: null as Principal | null,
          tenant: null as TenantContext | null,
        };
        return runWithRequestContext(ctx, async () => {
          const surface = surfaceOf(req);
          if (!surface) throw new AppError('not_found');
          const drainToken = surface === 'api' ? drainTokenOf(req) : null;
          if (drainToken) {
            // A drain grant (X38) is for one route, alone: not on any other operation, never next to a session.
            if (operationId !== 'syncPush' || req.cookies[SESSION_COOKIE])
              throw new AppError('auth.unauthenticated', 'That token cannot be used here.');
            const params = parse(def.params, req.params, true) as Record<string, string>;
            const orgId = decodeId('org', params.orgId ?? '');
            if (!orgId) throw new AppError('org.not_found');
            const body = parse(def.body, req.body, false) as Parameters<
              Modules['sync']['api']['drain']['handle']
            >[2];
            return send(reply, {
              status: 200,
              body: await modules.sync.api.drain.handle(
                orgId,
                drainToken,
                body,
                requestId,
                clientIp(req, config.clientIpHops),
              ),
            });
          }
          const { principal, viaCookie } = await authenticate(req, surface);
          if (def.auth === 'required' && !principal)
            throw new AppError('auth.unauthenticated', 'Sign in to continue.');
          checkCsrf(req, surface, viaCookie);
          ctx.principal = principal;

          const params = parse(def.params, req.params, true) as Record<string, string>;
          if (principal?.apiToken) checkApiToken(operationId, def, principal.apiToken, params);

          const query = parse(def.query, req.query, false);
          const body = parse(def.body, req.body, false);

          let tenant: TenantContext | null = null;
          if (params.orgId && principal) {
            tenant = await resolveTenant(params.orgId, principal, requestId);
            ctx.tenant = tenant;
            if (principal.apiToken && !tenant.entitlements.modules.includes('api'))
              throw new AppError(
                'entitlement-required',
                'Your plan does not include API access.',
                undefined,
                {
                  module: 'api',
                },
              );
            if (principal.apiToken) await limitRate(reply, principal.apiToken, tenant);
            checkEntitlement(def, tenant, req.method, operationId);
            // A flag launches a feature for chosen orgs; off looks the same as a route that does not exist.
            if (def.flag && !(await tenant.flags!.isOn(def.flag)))
              throw new AppError('feature-unavailable', 'This feature is not available yet.');
            if (def.permission) {
              const projectId = params.projectId ? decodeId('project', params.projectId) : null;
              if (params.projectId && !projectId) throw new AppError('project.not_found');
              await modules.database.withTenantTx(
                tenant,
                (scope) => modules.access.api.assert(scope, def.permission!, { projectId }),
                { readOnly: true },
              );
            }
          }

          const input: HandlerInput<OperationId> = {
            params: params as never,
            query: query as never,
            body: body as never,
            headers: req.headers as Record<string, string | undefined>,
            cookies: req.cookies,
            principal,
            tenant,
            requestId,
            ip: clientIp(req, config.clientIpHops),
            userAgent: req.headers['user-agent'] ?? null,
          };

          const idemKey =
            req.method === 'POST'
              ? (req.headers['idempotency-key'] as string | undefined)
              : undefined;
          if (idempotency && idemKey && principal) {
            const hash = idempotency.requestHash(req.method, req.url, req.body);
            const prior = await idempotency.begin(
              tenant?.orgId ?? null,
              principal.userId,
              idemKey,
              hash,
            );
            if (prior) {
              void reply.header('idempotent-replayed', 'true');
              return send(reply, {
                status: prior.status,
                body: prior.body,
                headers: prior.headers,
              });
            }
            let result: HandlerResult;
            try {
              result = await handler(input);
            } catch (e) {
              // Failed requests release the key so the client can retry.
              await idempotency
                .finish(tenant?.orgId ?? null, principal.userId, idemKey, null)
                .catch(() => undefined);
              throw e;
            }
            await idempotency.finish(tenant?.orgId ?? null, principal.userId, idemKey, {
              hash,
              status: result.status,
              body: result.body,
              headers: result.headers ?? {},
            });
            return send(reply, result);
          }

          return send(reply, await handler(input));
        });
      },
    });
  }
}
