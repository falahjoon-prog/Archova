import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is calling. Both cookie sessions and bearer tokens resolve to this (ADR-0004 §4). */
export interface Principal {
  userId: string;
  sessionId: string;
  client: 'web' | 'ios' | 'android' | 'api';
  authMethod: 'password' | 'passkey' | 'sso' | 'oauth' | 'api_token';
  authTime: Date;
  /** Set when the caller used a personal access token: it works in one org and only within these scopes. */
  apiToken?: { id: string; orgId: string; scopes: readonly string[] };
}

export type PrincipalType = 'member' | 'external';

/** Per-request tenant context (multi-tenancy.md §3). The org always comes from the URL path (X4). */
export interface TenantContext {
  orgId: string;
  userId: string;
  principalType: PrincipalType;
  orgRole: 'owner' | 'admin' | 'billing_admin' | 'member' | null;
  entitlements: Entitlements;
  requestId: string;
  /**
   * Set when the caller is a person on an access link (X45) rather than a signed-in user. `userId` is then the
   * subject's id in the owning module (a workforce worker), never an identity user.
   */
  actor?: LinkActor;
}

export interface LinkActor {
  type: 'link';
  linkId: string;
  subjectType: string | null;
  subjectId: string | null;
}

export interface Entitlements {
  plan: string;
  state: 'trialing' | 'active' | 'past_due' | 'read_only' | 'cancelled';
  modules: readonly string[];
  limits: Readonly<Record<string, number | null>>;
}

export interface RequestContext {
  requestId: string;
  traceId: string | null;
  principal: Principal | null;
  tenant: TenantContext | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
