import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type Principal, type TenantContext } from '@archova/kernel';
import {
  APP_ACCESS_PREFIX,
  APP_REFRESH_PREFIX,
  APP_SCOPES,
  unknownAppScopes,
} from '../domain/api-scopes';
import {
  APP_ACCESS_TTL_S,
  APP_REFRESH_ABSOLUTE_MS,
  APP_REFRESH_IDLE_MS,
  AUTH_CODE_TTL_MS,
} from '../domain/policy';
import { appCodes, appEvents, appInstalls, appTokens, oauthClients, users } from '../infra/tables';
import { newToken, safeEqual, sha256, verifyPkce } from './crypto';

export type ClientRow = typeof oauthClients.$inferSelect;
export type InstallRow = typeof appInstalls.$inferSelect;

/** Apps an org may register, and the redirect addresses one app may list. */
const MAX_APPS_PER_ORG = 10;
const MAX_REDIRECTS = 5;
const TOUCH_INTERVAL_MS = 60_000;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export interface PartnerAppsDeps {
  /** Platform kill switch. Off means no app can be registered, installed, exchanged or authenticated. */
  enabled: boolean;
  /** The web consent page an app's authorisation request is sent to. */
  consentUrl: string;
  /** Tells every active owner and admin of an org something happened to their apps. Best effort. */
  notifyAdmins: (orgId: string, subject: string, text: string) => Promise<void>;
  now?: () => Date;
}

export interface CreateAppInput {
  name: string;
  description?: string | undefined;
  redirectUris: string[];
  scopes: string[];
}

export interface InstallInput {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  scopes: string[];
}

export interface AppTokenInput {
  grant_type: 'authorization_code' | 'refresh_token';
  client_id: string;
  client_secret?: string | undefined;
  code?: string | undefined;
  redirect_uri?: string | undefined;
  code_verifier?: string | undefined;
  refresh_token?: string | undefined;
}

/** A redirect address must be an exact, absolute https URL with no fragment and no embedded credentials. */
export function redirectProblem(uri: string): string | null {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return 'Redirect addresses must be full URLs.';
  }
  if (u.protocol !== 'https:') return 'Redirect addresses must use https.';
  if (u.hash || uri.includes('#')) return 'Redirect addresses cannot have a fragment.';
  if (u.username || u.password) return 'Redirect addresses cannot contain credentials.';
  return null;
}

const lookupContext = (orgId: string): TenantContext => ({
  orgId,
  userId: NIL_UUID,
  principalType: 'member',
  orgRole: null,
  entitlements: { plan: '', state: 'active', modules: [], limits: {} },
  requestId: 'partner-app-lookup',
});

const isAdmin = (t: TenantContext) =>
  t.principalType === 'member' && (t.orgRole === 'owner' || t.orgRole === 'admin');

const invalidGrant = (msg = 'The grant is invalid, expired or already used.') =>
  new AppError('oauth.invalid_grant', msg);

export function createPartnerAppService(database: Database, deps: PartnerAppsDeps) {
  const now = deps.now ?? (() => new Date());

  function requireEnabled() {
    if (!deps.enabled)
      throw new AppError('feature-unavailable', 'Partner apps are not available yet.');
  }
  function requireAdmin(t: TenantContext) {
    if (!isAdmin(t))
      throw new AppError('app.not_allowed', 'Only an owner or admin can manage apps.');
  }

  async function getClient(clientId: string): Promise<ClientRow | null> {
    const [c] = await database.withGlobalTx('identity', (tx) =>
      tx.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1),
    );
    return c ?? null;
  }
  const usable = (c: ClientRow | null): c is ClientRow =>
    Boolean(c && !c.firstParty && !c.disabledAt && c.ownerOrgId);

  async function event(
    tx: Parameters<Parameters<Database['withTenantTx']>[1]>[0]['tx'],
    orgId: string,
    clientId: string,
    kind: typeof appEvents.$inferInsert.event,
    userId: string | null,
    ip: string | null,
    installId: string | null = null,
    detail: Record<string, unknown> | null = null,
  ) {
    await tx.insert(appEvents).values({
      id: uuidv7(),
      orgId,
      clientId,
      installId,
      event: kind,
      userId,
      ip,
      detail,
      createdAt: now(),
    });
  }

  function validateScopes(scopes: string[], allowed: readonly string[]) {
    const unique = [...new Set(scopes)];
    const bad = [...unknownAppScopes(unique), ...unique.filter((s) => !allowed.includes(s))];
    if (!unique.length || bad.length)
      throw new AppError(
        'app.invalid_scope',
        bad.length
          ? `Unknown or unavailable scope: ${[...new Set(bad)].join(', ')}.`
          : 'Choose at least one scope.',
      );
    return unique;
  }

  // ---- registration (owner/admin, step-up checked by the route) ----------------------------------------------

  async function createApp(tenant: TenantContext, input: CreateAppInput, ip: string | null) {
    requireEnabled();
    requireAdmin(tenant);
    const name = input.name.trim();
    if (!name || name.length > 80)
      throw new AppError('validation_failed', 'An app needs a name of up to 80 characters.');
    const redirects = [...new Set(input.redirectUris)];
    if (!redirects.length || redirects.length > MAX_REDIRECTS)
      throw new AppError('app.invalid_redirect', `List 1 to ${MAX_REDIRECTS} redirect addresses.`);
    for (const r of redirects) {
      const problem = redirectProblem(r);
      if (problem) throw new AppError('app.invalid_redirect', problem);
    }
    const scopes = validateScopes(input.scopes, APP_SCOPES);
    const existing = await database.withGlobalTx('identity', (tx) =>
      tx
        .select({ id: oauthClients.id })
        .from(oauthClients)
        .where(eq(oauthClients.ownerOrgId, tenant.orgId)),
    );
    if (existing.length >= MAX_APPS_PER_ORG)
      throw new AppError(
        'app.limit_reached',
        'This organisation has registered as many apps as it can.',
      );
    const clientId = `app_${randomBytes(12).toString('hex')}`;
    const secret = `cs_${newToken()}`;
    await database.withGlobalTx('identity', (tx) =>
      tx.insert(oauthClients).values({
        id: uuidv7(),
        clientId,
        name,
        clientSecretHash: sha256(secret).toString('hex'),
        firstParty: false,
        redirectUris: redirects,
        scopes,
        ownerOrgId: tenant.orgId,
        description: input.description?.trim() || null,
      }),
    );
    await database.withTenantTx(tenant, ({ tx }) =>
      event(tx, tenant.orgId, clientId, 'app_created', tenant.userId, ip),
    );
    return { clientId, secret, name, redirectUris: redirects, scopes };
  }

  async function listApps(tenant: TenantContext) {
    requireAdmin(tenant);
    return database.withGlobalTx('identity', (tx) =>
      tx.select().from(oauthClients).where(eq(oauthClients.ownerOrgId, tenant.orgId)),
    );
  }

  async function rotateSecret(tenant: TenantContext, clientId: string, ip: string | null) {
    requireEnabled();
    requireAdmin(tenant);
    const secret = `cs_${newToken()}`;
    const done = await database.withGlobalTx('identity', (tx) =>
      tx
        .update(oauthClients)
        .set({ clientSecretHash: sha256(secret).toString('hex') })
        .where(and(eq(oauthClients.clientId, clientId), eq(oauthClients.ownerOrgId, tenant.orgId)))
        .returning({ id: oauthClients.id }),
    );
    if (!done.length) throw new AppError('app.not_found');
    await database.withTenantTx(tenant, ({ tx }) =>
      event(tx, tenant.orgId, clientId, 'secret_rotated', tenant.userId, ip),
    );
    return { clientId, secret };
  }

  // ---- consent ------------------------------------------------------------------------------------------------

  /** What the consent page shows. The redirect address must be one the app registered, exactly. */
  async function consentInfo(clientId: string, redirectUri: string) {
    requireEnabled();
    const client = await getClient(clientId);
    if (!usable(client)) throw new AppError('oauth.invalid_client', 'Unknown app.');
    if (!client.redirectUris.includes(redirectUri))
      throw new AppError('oauth.invalid_request', 'redirect_uri is not registered for this app.');
    return {
      clientId: client.clientId,
      name: client.name,
      description: client.description,
      ownerOrgId: client.ownerOrgId!,
      scopes: client.scopes.filter((s) => APP_SCOPES.includes(s)),
    };
  }

  /** Where `/oauth/authorize` sends the signed-in person for a third-party app, after checking the request. */
  async function consentRedirect(
    client: ClientRow,
    q: { redirect_uri: string; code_challenge: string; state: string },
  ): Promise<string> {
    requireEnabled();
    if (!usable(client)) throw new AppError('oauth.invalid_client', 'Unknown app.');
    if (!client.redirectUris.includes(q.redirect_uri))
      throw new AppError('oauth.invalid_request', 'redirect_uri is not registered for this app.');
    const url = new URL(deps.consentUrl);
    url.searchParams.set('client_id', client.clientId);
    url.searchParams.set('redirect_uri', q.redirect_uri);
    url.searchParams.set('code_challenge', q.code_challenge);
    url.searchParams.set('state', q.state);
    return url.toString();
  }

  /**
   * An owner or admin approves an app for their org. Private apps install only into the org that owns them. Returns
   * the address to send the browser to, carrying a single-use 60-second code.
   */
  async function install(tenant: TenantContext, input: InstallInput, ip: string | null) {
    requireEnabled();
    requireAdmin(tenant);
    const client = await getClient(input.clientId);
    if (!usable(client)) throw new AppError('oauth.invalid_client', 'Unknown app.');
    if (client.ownerOrgId !== tenant.orgId)
      throw new AppError(
        'app.not_allowed',
        'This app can only be installed by the organisation that made it.',
      );
    if (!client.redirectUris.includes(input.redirectUri))
      throw new AppError('app.invalid_redirect', 'redirect_uri is not registered for this app.');
    const scopes = validateScopes(input.scopes, client.scopes);
    const code = newToken();
    const at = now();
    const installId = await database.withTenantTx(tenant, async ({ tx }) => {
      const [live] = await tx
        .select()
        .from(appInstalls)
        .where(
          and(
            eq(appInstalls.orgId, tenant.orgId),
            eq(appInstalls.clientId, client.clientId),
            isNull(appInstalls.revokedAt),
          ),
        )
        .limit(1);
      let id: string;
      if (live) {
        id = live.id;
        await tx.update(appInstalls).set({ scopes }).where(eq(appInstalls.id, live.id));
        if ([...live.scopes].sort().join() !== [...scopes].sort().join())
          await event(tx, tenant.orgId, client.clientId, 'scope_changed', tenant.userId, ip, id, {
            from: live.scopes,
            to: scopes,
          });
      } else {
        id = uuidv7();
        await tx.insert(appInstalls).values({
          id,
          orgId: tenant.orgId,
          clientId: client.clientId,
          installedBy: tenant.userId,
          scopes,
          createdAt: at,
        });
      }
      await tx.insert(appCodes).values({
        codeHash: sha256(code),
        clientId: client.clientId,
        userId: tenant.userId,
        targetOrgId: tenant.orgId,
        installId: id,
        familyId: uuidv7(),
        redirectUri: input.redirectUri,
        codeChallenge: input.codeChallenge,
        expiresAt: new Date(at.getTime() + AUTH_CODE_TTL_MS),
      });
      await event(tx, tenant.orgId, client.clientId, 'installed', tenant.userId, ip, id);
      return id;
    });
    void installId;
    await deps
      .notifyAdmins(
        tenant.orgId,
        `${client.name} was installed on your Archova account`,
        `${client.name} was approved for your company with these permissions: ${scopes.join(', ')}.\n\nYou can see every installed app and remove one at any time under Settings, Apps.\n\nIf you did not expect this, remove the app now.`,
      )
      .catch(() => undefined);
    const url = new URL(input.redirectUri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async function listInstalls(tenant: TenantContext) {
    requireAdmin(tenant);
    const rows = await database.withTenantTx(tenant, ({ tx }) =>
      tx
        .select()
        .from(appInstalls)
        .where(eq(appInstalls.orgId, tenant.orgId))
        .orderBy(desc(appInstalls.createdAt))
        .limit(200),
    );
    const names = rows.length
      ? await database.withGlobalTx('identity', (tx) =>
          tx
            .select({ clientId: oauthClients.clientId, name: oauthClients.name })
            .from(oauthClients)
            .where(inArray(oauthClients.clientId, [...new Set(rows.map((r) => r.clientId))])),
        )
      : [];
    return rows.map((r) => ({
      ...r,
      appName: names.find((n) => n.clientId === r.clientId)?.name ?? '',
    }));
  }

  /** Ends an install: every token it issued stops working on the next request. */
  async function revokeInstall(tenant: TenantContext, installId: string, ip: string | null) {
    requireAdmin(tenant);
    const at = now();
    const row = await database.withTenantTx(tenant, async ({ tx }) => {
      const [done] = await tx
        .update(appInstalls)
        .set({ revokedAt: at, revokedBy: tenant.userId })
        .where(
          and(
            eq(appInstalls.id, installId),
            eq(appInstalls.orgId, tenant.orgId),
            isNull(appInstalls.revokedAt),
          ),
        )
        .returning();
      if (done)
        await event(tx, tenant.orgId, done.clientId, 'revoked', tenant.userId, ip, installId);
      return done;
    });
    if (!row) throw new AppError('app.not_found');
    await database.withGlobalTx('identity', (tx) =>
      tx
        .update(appTokens)
        .set({ revokedAt: at })
        .where(and(eq(appTokens.installId, installId), isNull(appTokens.revokedAt))),
    );
    await deps
      .notifyAdmins(
        tenant.orgId,
        'An app was removed from your Archova account',
        'An app was removed from your company, and its access has ended.',
      )
      .catch(() => undefined);
  }

  // ---- token endpoint -----------------------------------------------------------------------------------------

  async function authenticateClient(input: AppTokenInput): Promise<ClientRow> {
    requireEnabled();
    const client = await getClient(input.client_id);
    // Same answer for an unknown app and a wrong secret.
    const bad = new AppError('oauth.invalid_client', 'Client authentication failed.');
    if (!usable(client) || !client.clientSecretHash || !input.client_secret) throw bad;
    if (!safeEqual(sha256(input.client_secret).toString('hex'), client.clientSecretHash)) throw bad;
    return client;
  }

  /** The install, if it is still live, with its user still active. Null otherwise. */
  async function liveInstall(orgId: string, installId: string, userId: string, clientId: string) {
    return database.withTenantTx(lookupContext(orgId), async ({ tx }) => {
      const [r] = await tx
        .select({ install: appInstalls })
        .from(appInstalls)
        .innerJoin(users, eq(users.id, userId))
        .where(
          and(
            eq(appInstalls.id, installId),
            eq(appInstalls.clientId, clientId),
            isNull(appInstalls.revokedAt),
            eq(users.status, 'active'),
          ),
        )
        .limit(1);
      return r?.install ?? null;
    });
  }

  async function issuePair(row: {
    installId: string;
    orgId: string;
    userId: string;
    scopes: string[];
    familyId: string;
    absoluteExpiresAt: Date;
  }) {
    const at = now();
    const access = `${APP_ACCESS_PREFIX}${newToken()}`;
    const refresh = `${APP_REFRESH_PREFIX}${newToken()}`;
    await database.withGlobalTx('identity', (tx) =>
      tx.insert(appTokens).values([
        {
          id: uuidv7(),
          installId: row.installId,
          targetOrgId: row.orgId,
          userId: row.userId,
          kind: 'access' as const,
          tokenHash: sha256(access),
          familyId: row.familyId,
          scopes: row.scopes,
          expiresAt: new Date(at.getTime() + APP_ACCESS_TTL_S * 1000),
          absoluteExpiresAt: row.absoluteExpiresAt,
          createdAt: at,
        },
        {
          id: uuidv7(),
          installId: row.installId,
          targetOrgId: row.orgId,
          userId: row.userId,
          kind: 'refresh' as const,
          tokenHash: sha256(refresh),
          familyId: row.familyId,
          scopes: row.scopes,
          expiresAt: new Date(
            Math.min(at.getTime() + APP_REFRESH_IDLE_MS, row.absoluteExpiresAt.getTime()),
          ),
          absoluteExpiresAt: row.absoluteExpiresAt,
          createdAt: at,
        },
      ]),
    );
    return {
      access_token: access,
      token_type: 'Bearer' as const,
      expires_in: APP_ACCESS_TTL_S,
      refresh_token: refresh,
      scope: row.scopes.join(' '),
    };
  }

  async function exchangeCode(client: ClientRow, input: AppTokenInput) {
    if (!input.code || !input.code_verifier || !input.redirect_uri)
      throw new AppError(
        'oauth.invalid_request',
        'code, code_verifier and redirect_uri are required.',
      );
    const code = input.code;
    // Burn the code first, in its own transaction, so a failed attempt cannot be retried.
    const [row] = await database.withGlobalTx('identity', (tx) =>
      tx
        .update(appCodes)
        .set({ usedAt: now() })
        .where(and(eq(appCodes.codeHash, sha256(code)), isNull(appCodes.usedAt)))
        .returning(),
    );
    if (!row) {
      // A code that was already used: whoever holds tokens from it is suspect, so end that whole family.
      const [used] = await database.withGlobalTx('identity', (tx) =>
        tx
          .select()
          .from(appCodes)
          .where(eq(appCodes.codeHash, sha256(code)))
          .limit(1),
      );
      if (used && used.clientId === client.clientId) {
        const ended = await database.withGlobalTx('identity', (tx) =>
          tx
            .update(appTokens)
            .set({ revokedAt: now() })
            .where(and(eq(appTokens.familyId, used.familyId), isNull(appTokens.revokedAt)))
            .returning({ id: appTokens.id }),
        );
        if (ended.length)
          await database.withTenantTx(lookupContext(used.targetOrgId), ({ tx }) =>
            event(
              tx,
              used.targetOrgId,
              client.clientId,
              'reuse_detected',
              used.userId,
              null,
              used.installId,
              {
                source: 'authorization_code',
              },
            ),
          );
      }
      throw invalidGrant();
    }
    if (row.expiresAt < now()) throw invalidGrant();
    if (row.clientId !== client.clientId || row.redirectUri !== input.redirect_uri)
      throw invalidGrant();
    if (!verifyPkce(input.code_verifier, row.codeChallenge))
      throw invalidGrant('PKCE verification failed.');
    const inst = await liveInstall(row.targetOrgId, row.installId, row.userId, client.clientId);
    if (!inst) throw invalidGrant();
    return issuePair({
      installId: inst.id,
      orgId: row.targetOrgId,
      userId: row.userId,
      scopes: inst.scopes,
      familyId: row.familyId,
      absoluteExpiresAt: new Date(now().getTime() + APP_REFRESH_ABSOLUTE_MS),
    });
  }

  async function rotateRefresh(client: ClientRow, input: AppTokenInput) {
    if (!input.refresh_token)
      throw new AppError('oauth.invalid_request', 'refresh_token is required.');
    const presented = input.refresh_token;
    if (!presented.startsWith(APP_REFRESH_PREFIX)) throw invalidGrant();
    const at = now();
    const [row] = await database.withGlobalTx('identity', (tx) =>
      tx
        .select()
        .from(appTokens)
        .where(and(eq(appTokens.tokenHash, sha256(presented)), eq(appTokens.kind, 'refresh')))
        .limit(1),
    );
    if (!row) throw invalidGrant();
    const inst = await liveInstall(row.targetOrgId, row.installId, row.userId, client.clientId);
    if (!inst) throw invalidGrant();
    if (row.usedAt) {
      // Someone holds an old refresh token: end this person's grant for the app, not everyone's.
      await database.withGlobalTx('identity', (tx) =>
        tx
          .update(appTokens)
          .set({ revokedAt: at })
          .where(
            and(
              eq(appTokens.installId, row.installId),
              eq(appTokens.userId, row.userId),
              isNull(appTokens.revokedAt),
            ),
          ),
      );
      await database.withTenantTx(lookupContext(row.targetOrgId), ({ tx }) =>
        event(
          tx,
          row.targetOrgId,
          client.clientId,
          'reuse_detected',
          row.userId,
          null,
          row.installId,
        ),
      );
      throw invalidGrant();
    }
    if (row.revokedAt || row.expiresAt <= at || row.absoluteExpiresAt <= at) throw invalidGrant();
    // Claim the token: only one of two simultaneous uses wins.
    const claimed = await database.withGlobalTx('identity', (tx) =>
      tx
        .update(appTokens)
        .set({ usedAt: at })
        .where(and(eq(appTokens.id, row.id), isNull(appTokens.usedAt)))
        .returning({ id: appTokens.id }),
    );
    if (!claimed.length) throw invalidGrant();
    return issuePair({
      installId: inst.id,
      orgId: row.targetOrgId,
      userId: row.userId,
      // The install's current scopes, so narrowing an install takes effect at the next refresh.
      scopes: inst.scopes,
      familyId: row.familyId,
      absoluteExpiresAt: row.absoluteExpiresAt,
    });
  }

  async function token(input: AppTokenInput) {
    const client = await authenticateClient(input);
    return input.grant_type === 'authorization_code'
      ? exchangeCode(client, input)
      : rotateRefresh(client, input);
  }

  /** RFC 7009: revoke a token the app holds. A refresh token takes that person's whole grant with it. */
  async function revokeToken(value: string, clientId: string) {
    const client = await getClient(clientId);
    if (!usable(client)) return;
    const [row] = await database.withGlobalTx('identity', (tx) =>
      tx
        .select()
        .from(appTokens)
        .where(eq(appTokens.tokenHash, sha256(value)))
        .limit(1),
    );
    if (!row) return;
    const inst = await liveInstall(row.targetOrgId, row.installId, row.userId, clientId);
    if (!inst) return;
    await database.withGlobalTx('identity', (tx) =>
      tx
        .update(appTokens)
        .set({ revokedAt: now() })
        .where(
          row.kind === 'refresh'
            ? and(
                eq(appTokens.installId, row.installId),
                eq(appTokens.userId, row.userId),
                isNull(appTokens.revokedAt),
              )
            : eq(appTokens.id, row.id),
        ),
    );
  }

  /**
   * Bearer authentication for `pa_live_…` access tokens, in the org named by the URL. Null unless the token is
   * live, belongs to that org, its install is live and the person who approved it is still active. The caller's
   * own org membership and permissions are still checked afterwards, like any other request.
   */
  async function authenticate(secret: string, orgId: string | null): Promise<Principal | null> {
    if (!deps.enabled || !orgId) return null;
    const at = now();
    const [row] = await database.withGlobalTx('identity', (tx) =>
      tx
        .select()
        .from(appTokens)
        .where(and(eq(appTokens.tokenHash, sha256(secret)), eq(appTokens.kind, 'access')))
        .limit(1),
    );
    if (!row || row.revokedAt || row.expiresAt <= at || row.targetOrgId !== orgId) return null;
    const live = await database.withTenantTx(lookupContext(orgId), async ({ tx }) => {
      const [r] = await tx
        .select({ install: appInstalls })
        .from(appInstalls)
        .innerJoin(users, eq(users.id, row.userId))
        .innerJoin(oauthClients, eq(oauthClients.clientId, appInstalls.clientId))
        .where(
          and(
            eq(appInstalls.id, row.installId),
            isNull(appInstalls.revokedAt),
            eq(users.status, 'active'),
            isNull(oauthClients.disabledAt),
          ),
        )
        .limit(1);
      if (!r) return null;
      const i = r.install;
      if (!i.lastUsedAt || at.getTime() - i.lastUsedAt.getTime() > TOUCH_INTERVAL_MS)
        await tx.update(appInstalls).set({ lastUsedAt: at }).where(eq(appInstalls.id, i.id));
      return i;
    });
    if (!live) return null;
    return {
      userId: row.userId,
      sessionId: row.id,
      client: 'api',
      authMethod: 'api_token',
      authTime: row.createdAt,
      // Rate limits count per install, not per short-lived token.
      apiToken: { id: live.id, orgId, scopes: live.scopes, app: true },
    };
  }

  return {
    enabled: deps.enabled,
    getClient,
    createApp,
    listApps,
    rotateSecret,
    consentInfo,
    consentRedirect,
    install,
    listInstalls,
    revokeInstall,
    token,
    revokeToken,
    authenticate,
  };
}

export type PartnerAppService = ReturnType<typeof createPartnerAppService>;
