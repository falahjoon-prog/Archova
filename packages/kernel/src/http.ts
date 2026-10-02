// Framework-neutral HTTP handler contract between modules and apps/api. Modules export handlers keyed by
// OpenAPI operationId; apps/api owns Fastify, authentication, tenant resolution, entitlement and validation
// and calls the handler with already-validated input. Keeps modules free of HTTP framework code.
import type { z } from 'zod';
import type { OperationId, operations } from '@archova/contracts';
import type { Principal, TenantContext } from './context';

type Ops = typeof operations;
type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : Record<string, never>;

export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: boolean;
  maxAgeSeconds: number | null;
}

export interface HandlerInput<K extends OperationId> {
  params: Infer<Ops[K]['params']>;
  query: Infer<Ops[K]['query']>;
  body: Infer<Ops[K]['body']>;
  headers: Readonly<Record<string, string | undefined>>;
  cookies: Readonly<Record<string, string | undefined>>;
  principal: Principal | null;
  tenant: TenantContext | null;
  requestId: string;
  ip: string;
  userAgent: string | null;
}

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  setCookies?: CookieSpec[];
  clearCookies?: string[];
  redirect?: string;
}

export type Handler<K extends OperationId> = (input: HandlerInput<K>) => Promise<HandlerResult>;

export type RouteTable = { [K in OperationId]?: Handler<K> };

/** Helper so a module's route table is checked against the contract's operationIds. */
export function defineRoutes<T extends RouteTable>(routes: T): T {
  return routes;
}

/** Principal that a handler requires (the API already enforces `x-auth`). */
export function requirePrincipal(input: { principal: Principal | null }): Principal {
  if (!input.principal) throw new Error('Handler requires an authenticated principal');
  return input.principal;
}

export function requireTenant(input: { tenant: TenantContext | null }): TenantContext {
  if (!input.tenant) throw new Error('Handler requires a tenant context');
  return input.tenant;
}
