import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { internalOperations, type InternalOperationId } from '@archova/contracts';
import { AppError, runWithRequestContext } from '@archova/kernel';
import type { BackofficeModule, InternalResult, StaffContext } from '@archova/mod-backoffice';
import type { ApiConfig } from './config';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `__Host-` needs Secure and so HTTPS; plain-http local runs use an unprefixed name. */
export const STAFF_COOKIE = '__Host-csid';
export const STAFF_COOKIE_LOCAL = 'csid';

/**
 * Mounts `/internal/v1` (backend 09 §1). It is separate from the customer pipeline: its own contract, its own staff
 * session realm, answers only on the console hosts, and fails closed. A customer session is never read here and a
 * staff session is never read on /v1.
 */
export function registerInternalOperations(
  app: FastifyInstance,
  deps: { config: ApiConfig; backoffice: BackofficeModule },
) {
  const { config, backoffice } = deps;
  const secure =
    config.env === 'production' || config.internal.origins.every((o) => o.startsWith('https:'));
  const cookieName = secure ? STAFF_COOKIE : STAFF_COOKIE_LOCAL;

  function checkOrigin(req: FastifyRequest) {
    if (!UNSAFE.has(req.method)) return;
    const origin = req.headers.origin;
    if (!origin || !config.internal.origins.includes(origin))
      throw new AppError('auth.csrf_failed', 'Cross-site request blocked.');
  }

  for (const [operationId, def] of Object.entries(internalOperations) as Array<
    [InternalOperationId, (typeof internalOperations)[InternalOperationId]]
  >) {
    const handler = backoffice.internal[operationId] as unknown as (
      input: Record<string, unknown>,
    ) => Promise<InternalResult>;
    app.route({
      method: def.method,
      url: def.path.replace(/\{(\w+)\}/g, ':$1'),
      handler: async (req, reply) => {
        const requestId = randomUUID();
        void reply.header('x-request-id', requestId);
        void reply.header('cache-control', 'no-store');
        const ctx = { requestId, traceId: null, principal: null, tenant: null };
        return runWithRequestContext(ctx, async () => {
          // Fail closed: on any other host (app., api.) the console does not exist.
          if (!config.internal.hosts.includes(req.host.toLowerCase()))
            throw new AppError('not_found');
          checkOrigin(req);
          let staff: StaffContext | null = null;
          if (def.auth === 'staff') {
            if (req.headers.authorization)
              throw new AppError('auth.wrong_origin_credential', 'Staff use the session cookie.');
            const token = req.cookies[cookieName];
            staff = token ? await backoffice.api.resolveStaff(token) : null;
            if (!staff) throw new AppError('auth.unauthenticated', 'Sign in to continue.');
            const permission = 'permission' in def ? def.permission : undefined;
            if (permission && !staff.permissions.includes(permission))
              throw new AppError('backoffice.permission_denied', 'Your role does not allow this.');
            if ('stepUp' in def && def.stepUp) backoffice.api.requireStepUp(staff);
          }
          const parse = (
            schema: {
              safeParse(v: unknown): { success: boolean; data?: unknown; error?: unknown };
            } | null,
            value: unknown,
            notFound: boolean,
          ) => {
            if (!schema) return {};
            const r = schema.safeParse(value ?? {});
            if (r.success) return r.data;
            if (notFound) throw new AppError('not_found');
            throw r.error;
          };
          const result = await handler({
            params: parse(def.params, req.params, true),
            query: parse(def.query, req.query, false),
            body: parse(def.body, req.body, false),
            staff,
            ip: req.ip,
            userAgent: req.headers['user-agent'] ?? null,
          });
          if (result.sessionCookie)
            void reply.setCookie(cookieName, result.sessionCookie.token, {
              path: '/',
              secure,
              httpOnly: true,
              sameSite: 'strict',
              maxAge: result.sessionCookie.maxAgeSeconds,
            });
          if (result.clearSessionCookie)
            void reply.clearCookie(cookieName, {
              path: '/',
              secure,
              httpOnly: true,
              sameSite: 'strict',
            });
          void reply.status(result.status);
          return result.body === undefined ? reply.send() : reply.send(result.body);
        });
      },
    });
  }
}
