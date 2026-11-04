import { randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantScope } from '@archova/kernel';
import {
  RateLimiter,
  UnmappedCostCodeError,
  authorizeUrl,
  createMyobProvider,
  createTokenSession,
  createXeroProvider,
  exchangeCode,
  listTargets,
  newPkce,
  refreshTokens,
  ProviderRequestError,
  type AccountingProvider,
  type FetchLike,
  type FieldMap,
  type LedgerDocument,
  type RemotePayment,
  type TokenSet,
  type TokenVault,
} from '../domain/accounting';
import {
  accountingConnections,
  accountingContacts,
  accountingDocuments,
  accountingPayments,
  accountingSyncIssues,
  type AccountingProviderKey,
  type ConnectionSettings,
  type StoredFieldMap,
  type SyncIssueKind,
} from '../infra/tables';

export type ConnectionRow = typeof accountingConnections.$inferSelect;
export type SyncIssueRow = typeof accountingSyncIssues.$inferSelect;

/** A claim or schedule from the financials module, in cents. The same shape as financials' `LedgerSource`. */
export interface LedgerSourceInput {
  kind: 'bill' | 'invoice';
  localType: 'payment_schedule' | 'claim';
  localId: string;
  contractNumber: number;
  claimNumber: number;
  counterparty: { companyId: string; name: string; abn: string | null } | null;
  date: string;
  dueDate: string;
  lines: { code: string; description: string; amountCents: number; gstCents: number }[];
  retentionCents: number;
}

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}
export interface AccountingDeps {
  vault: TokenVault;
  fetch: FetchLike;
  // Base of the web page the provider sends the admin back to: `{redirectBase}/{provider}/callback`. Register that
  // exact address with each provider. The page posts the code and state to the callback route.
  redirectBase: string;
  credentials: Record<AccountingProviderKey, ProviderCredentials | null>;
  /**
   * When given, a token refresh runs in its own transaction under a row lock and commits at once. Refresh tokens
   * rotate on use, so a caller that later rolls back must not lose the new one, and two callers must not both spend
   * the old one. Without it the refresh joins the caller's transaction (tests only).
   */
  database?: Database;
  now?: () => Date;
}

const DEFAULT_SETTINGS: ConnectionSettings = {
  startDate: null,
  pushBills: true,
  pushInvoices: true,
  billStatus: 'draft',
};
const EMPTY_MAP: StoredFieldMap = { accounts: {}, retention: null };
// One limiter per org and provider in this process: Xero 50/min with 2 in flight, MYOB 2/s per file
// (integrations/02 §4, §5). The app-wide MYOB cap is a worker concern.
/** How long a sign-in link stays valid. */
const STATE_TTL_MS = 10 * 60_000;
const BUDGET = { xero: [50, 2], myob: [120, 2] } as const;

export function createAccountingService(deps: AccountingDeps) {
  const now = () => (deps.now ?? (() => new Date()))();
  const limiters = new Map<string, RateLimiter>();
  const limiter = (orgId: string, provider: AccountingProviderKey) => {
    const key = `${orgId}:${provider}`;
    let l = limiters.get(key);
    if (!l) limiters.set(key, (l = new RateLimiter(BUDGET[provider][0], BUDGET[provider][1])));
    return l;
  };
  const creds = (provider: AccountingProviderKey) => {
    const c = deps.credentials[provider];
    if (!c)
      throw new AppError(
        'accounting.not_configured',
        `${provider === 'xero' ? 'Xero' : 'MYOB'} is not set up on this installation yet.`,
      );
    return c;
  };
  const redirectUri = (provider: AccountingProviderKey) =>
    `${deps.redirectBase}/${provider}/callback`;
  const sealTokens = (orgId: string, t: TokenSet) => deps.vault.seal(orgId, JSON.stringify(t));
  const openTokens = (orgId: string, row: ConnectionRow): TokenSet =>
    JSON.parse(deps.vault.open(orgId, row.tokensSealed as Buffer)) as TokenSet;

  async function find(scope: TenantScope, provider: AccountingProviderKey) {
    const [row] = await scope.tx
      .select()
      .from(accountingConnections)
      .where(eq(accountingConnections.provider, provider));
    return row ?? null;
  }
  async function require(scope: TenantScope, provider: AccountingProviderKey) {
    const row = await find(scope, provider);
    if (!row) throw new AppError('accounting.not_found');
    return row;
  }

  const list = (scope: TenantScope) =>
    scope.tx.select().from(accountingConnections).orderBy(accountingConnections.provider);

  /** Step 1: remember a one-time state and PKCE verifier, and return where to send the admin. */
  async function start(scope: TenantScope, userId: string, provider: AccountingProviderKey) {
    const c = creds(provider);
    const state = randomBytes(24).toString('base64url');
    const pkce = newPkce();
    const values = {
      status: 'pending' as const,
      oauthState: state,
      oauthStateAt: now(),
      verifierSealed: deps.vault.seal(scope.ctx.orgId, pkce.verifier),
      lastError: null,
      updatedAt: now(),
    };
    const existing = await find(scope, provider);
    if (existing) {
      await scope.tx
        .update(accountingConnections)
        .set(existing.status === 'active' ? { ...values, status: existing.status } : values)
        .where(eq(accountingConnections.id, existing.id));
    } else {
      await scope.tx.insert(accountingConnections).values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        provider,
        createdBy: userId,
        fieldMap: EMPTY_MAP,
        settings: DEFAULT_SETTINGS,
        ...values,
      });
    }
    return {
      url: authorizeUrl(provider, {
        clientId: c.clientId,
        redirectUri: redirectUri(provider),
        state,
        challenge: pkce.challenge,
      }),
    };
  }

  /** Step 2a (no transaction open): the state matches a pending connection; the verifier is read. */
  async function prepareCallback(
    scope: TenantScope,
    provider: AccountingProviderKey,
    state: string,
  ) {
    const row = await require(scope, provider);
    const fresh = row.oauthStateAt && now().getTime() - row.oauthStateAt.getTime() <= STATE_TTL_MS;
    if (!row.oauthState || row.oauthState !== state || !row.verifierSealed || !fresh)
      throw new AppError('accounting.bad_state', 'This sign-in link has expired. Start again.');
    return deps.vault.open(scope.ctx.orgId, row.verifierSealed);
  }

  /** A failed exchange spends the state: the code is single use, so the link cannot be retried. */
  async function abandonCallback(scope: TenantScope, provider: AccountingProviderKey) {
    await scope.tx
      .update(accountingConnections)
      .set({ oauthState: null, oauthStateAt: null, verifierSealed: null, updatedAt: now() })
      .where(eq(accountingConnections.provider, provider));
  }

  /** Step 2b: exchanges the code with the provider. Nothing is stored yet. */
  async function exchange(provider: AccountingProviderKey, code: string, verifier: string) {
    try {
      const tokens = await exchangeCode(
        provider,
        deps.fetch,
        creds(provider),
        { code, redirectUri: redirectUri(provider), verifier },
        () => now().getTime(),
      );
      const targets = await listTargets(
        provider,
        deps.fetch,
        tokens.accessToken,
        creds(provider).clientId,
      );
      return { tokens, targets };
    } catch (e) {
      if (e instanceof ProviderRequestError)
        throw new AppError(
          'accounting.provider_error',
          'The accounting system refused the sign-in.',
        );
      throw e;
    }
  }

  /** Step 2c: stores the tokens. One target is selected automatically; several wait for `selectTarget`. */
  async function finishCallback(
    scope: TenantScope,
    provider: AccountingProviderKey,
    state: string,
    result: { tokens: TokenSet; targets: { ref: string; name: string }[] },
  ) {
    const row = await require(scope, provider);
    if (row.oauthState !== state)
      throw new AppError('accounting.bad_state', 'This sign-in link has expired. Start again.');
    const only = result.targets.length === 1 ? result.targets[0]! : null;
    const [saved] = await scope.tx
      .update(accountingConnections)
      .set({
        status: only ? 'active' : 'needs_target',
        oauthState: null,
        oauthStateAt: null,
        verifierSealed: null,
        tokensSealed: sealTokens(scope.ctx.orgId, result.tokens),
        tokenExpiresAt: new Date(result.tokens.expiresAt),
        targetRef: only?.ref ?? null,
        targetName: only?.name ?? null,
        lastError: null,
        updatedAt: now(),
      })
      .where(eq(accountingConnections.id, row.id))
      .returning();
    return { connection: saved!, targets: result.targets };
  }

  /** Lists what the signed-in account can reach, for the picker when `needs_target`. */
  async function targets(scope: TenantScope, provider: AccountingProviderKey) {
    const row = await require(scope, provider);
    if (!row.tokensSealed) throw new AppError('accounting.not_ready', 'Sign in first.');
    const tokens = openTokens(scope.ctx.orgId, row);
    try {
      return await listTargets(provider, deps.fetch, tokens.accessToken, creds(provider).clientId);
    } catch {
      throw new AppError(
        'accounting.provider_error',
        'Could not list the available organisations.',
      );
    }
  }

  /**
   * The ref must be one the signed-in account can actually reach; the name stored is the provider's, not the client's.
   * `available` comes from `targets`, read before this transaction so the provider call holds none open.
   */
  async function selectTarget(
    scope: TenantScope,
    provider: AccountingProviderKey,
    ref: string,
    available: { ref: string; name: string }[],
  ) {
    const row = await require(scope, provider);
    if (!row.tokensSealed) throw new AppError('accounting.not_ready', 'Sign in first.');
    const target = available.find((t) => t.ref === ref);
    if (!target)
      throw new AppError(
        'accounting.invalid_target',
        'That organisation is not available to this sign-in.',
        [{ path: 'ref', message: 'Not one of the available choices' }],
      );
    const [saved] = await scope.tx
      .update(accountingConnections)
      .set({ status: 'active', targetRef: target.ref, targetName: target.name, updatedAt: now() })
      .where(eq(accountingConnections.id, row.id))
      .returning();
    return saved!;
  }

  async function disconnect(scope: TenantScope, provider: AccountingProviderKey) {
    const row = await require(scope, provider);
    // Pushed documents stay in the accounting system untouched; only our access and links go.
    await scope.tx
      .delete(accountingSyncIssues)
      .where(eq(accountingSyncIssues.connectionId, row.id));
    await scope.tx.delete(accountingPayments).where(eq(accountingPayments.connectionId, row.id));
    await scope.tx.delete(accountingDocuments).where(eq(accountingDocuments.connectionId, row.id));
    await scope.tx.delete(accountingConnections).where(eq(accountingConnections.id, row.id));
  }

  async function setFieldMap(
    scope: TenantScope,
    provider: AccountingProviderKey,
    map: StoredFieldMap,
  ) {
    const row = await require(scope, provider);
    const [saved] = await scope.tx
      .update(accountingConnections)
      .set({ fieldMap: map, updatedAt: now() })
      .where(eq(accountingConnections.id, row.id))
      .returning();
    return saved!;
  }

  async function setSettings(
    scope: TenantScope,
    provider: AccountingProviderKey,
    settings: ConnectionSettings,
  ) {
    const row = await require(scope, provider);
    const [saved] = await scope.tx
      .update(accountingConnections)
      .set({ settings, updatedAt: now() })
      .where(eq(accountingConnections.id, row.id))
      .returning();
    return saved!;
  }

  async function raise(
    scope: TenantScope,
    connectionId: string,
    kind: SyncIssueKind,
    message: string,
    reference: string | null,
  ) {
    // One open issue per reference and kind: a retry does not pile up duplicates.
    const open = await scope.tx
      .select({ id: accountingSyncIssues.id })
      .from(accountingSyncIssues)
      .where(
        and(
          eq(accountingSyncIssues.connectionId, connectionId),
          eq(accountingSyncIssues.kind, kind),
          eq(accountingSyncIssues.status, 'open'),
          reference === null ? undefined : eq(accountingSyncIssues.reference, reference),
        ),
      );
    if (open.length) return;
    await scope.tx.insert(accountingSyncIssues).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      connectionId,
      kind,
      reference,
      message,
    });
  }

  /** A provider whose access token refreshes itself and stores each rotated refresh token before it is used. */
  function providerFor(scope: TenantScope, row: ConnectionRow): AccountingProvider {
    const provider = row.provider;
    const c = creds(provider);
    const refreshOnce = async (s: TenantScope, stale: string): Promise<TokenSet> => {
      const [cur] = await s.tx
        .select()
        .from(accountingConnections)
        .where(eq(accountingConnections.id, row.id))
        .for('update');
      if (!cur?.tokensSealed) throw new AppError('accounting.not_ready', 'Sign in first.');
      const stored = openTokens(s.ctx.orgId, cur);
      // Someone else refreshed while we waited for the lock: use theirs, since the old token is spent.
      if (stored.refreshToken !== stale) return stored;
      const fresh = await refreshTokens(provider, deps.fetch, c, stale, () => now().getTime());
      await s.tx
        .update(accountingConnections)
        .set({
          tokensSealed: sealTokens(s.ctx.orgId, fresh),
          tokenExpiresAt: new Date(fresh.expiresAt),
          updatedAt: now(),
        })
        .where(eq(accountingConnections.id, row.id));
      return fresh;
    };
    const session = createTokenSession(
      openTokens(scope.ctx.orgId, row),
      (stale) =>
        deps.database
          ? deps.database.withTenantTx(scope.ctx, (s) => refreshOnce(s, stale))
          : refreshOnce(scope, stale),
      async () => {},
      () => now().getTime(),
    );
    const lim = limiter(scope.ctx.orgId, provider);
    return provider === 'xero'
      ? createXeroProvider({ accessToken: session, tenantId: row.targetRef! }, deps.fetch, lim)
      : createMyobProvider(
          {
            accessToken: session,
            apiKey: c.clientId,
            companyFileUrl: `https://api.myob.com/accountright/${row.targetRef}`,
          },
          deps.fetch,
          lim,
        );
  }

  const toFieldMap = (m: StoredFieldMap): FieldMap | null =>
    m.retention ? { accounts: m.accounts, retention: m.retention } : null;

  /** Turns a failure that needs a person into a sync issue; anything else (a retryable error, a bug) is rethrown. */
  async function failure(
    scope: TenantScope,
    row: ConnectionRow,
    e: unknown,
    ref: string,
  ): Promise<'issue'> {
    if (e instanceof UnmappedCostCodeError) {
      await raise(
        scope,
        row.id,
        'unmapped_cost_code',
        `No account is mapped for cost code ${e.costCodes.join(', ')}.`,
        ref,
      );
      return 'issue';
    }
    if (e instanceof ProviderRequestError && !e.retryable) {
      const kind: SyncIssueKind = e.status === 401 || e.status === 403 ? 'auth_failed' : 'rejected';
      // Provider error bodies stay in the logs; customers see a fixed sentence.
      const text =
        kind === 'auth_failed'
          ? 'The accounting system refused our access. Reconnect it.'
          : `The accounting system refused ${ref} (HTTP ${e.status}).`;
      if (kind === 'auth_failed')
        await scope.tx
          .update(accountingConnections)
          .set({ status: 'error', lastError: text, updatedAt: now() })
          .where(eq(accountingConnections.id, row.id));
      await raise(scope, row.id, kind, text, ref);
      return 'issue';
    }
    throw e;
  }

  /**
   * Pushes a bill or invoice from the commercial module (integrations/02 A4, A5). Returns what happened; problems that
   * need a person (an unmapped cost code, a document the bookkeeper already approved, a refusal) become sync issues,
   * not exceptions, so a batch keeps going. Provider calls run inside the caller's transaction, as webhook delivery does.
   */
  async function push(
    scope: TenantScope,
    provider: AccountingProviderKey,
    input: { localType: 'payment_schedule' | 'claim'; localId: string; document: LedgerDocument },
  ): Promise<'skipped' | 'created' | 'updated' | 'locked' | 'issue'> {
    const row = await find(scope, provider);
    if (!row || row.status !== 'active') return 'skipped';
    const { settings } = row;
    if (input.document.kind === 'bill' ? !settings.pushBills : !settings.pushInvoices)
      return 'skipped';
    // Nothing before the start date is pushed.
    if (settings.startDate && input.document.date < settings.startDate) return 'skipped';
    const map = toFieldMap(row.fieldMap);
    const ref = input.document.reference;
    if (!map) {
      await raise(
        scope,
        row.id,
        'unmapped_cost_code',
        'Set the retention account in the field map first.',
        ref,
      );
      return 'issue';
    }
    const document = { ...input.document, status: settings.billStatus };
    try {
      const r = await providerFor(scope, row).push(document, map);
      await scope.tx
        .insert(accountingDocuments)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          connectionId: row.id,
          localType: input.localType,
          localId: input.localId,
          reference: ref,
          remoteId: r.remoteId,
          remoteVersion: r.remoteVersion,
          remoteStatus: r.remoteStatus,
        })
        .onConflictDoUpdate({
          target: [
            accountingDocuments.connectionId,
            accountingDocuments.localType,
            accountingDocuments.localId,
          ],
          set: {
            remoteId: r.remoteId,
            remoteVersion: r.remoteVersion,
            remoteStatus: r.remoteStatus,
            pushedAt: now(),
          },
        });
      if (r.outcome === 'locked') {
        await raise(
          scope,
          row.id,
          'remote_locked',
          `${ref} is already ${r.remoteStatus} in the accounting system, so it was not changed. Adjust it there, for example with a credit note.`,
          ref,
        );
        return 'locked';
      }
      return r.outcome;
    } catch (e) {
      return failure(scope, row, e, ref);
    }
  }

  /**
   * Records a claim or payment schedule from the financials module as a bill or invoice (A4, A5). Finds the supplier or
   * customer first, by ABN and then by exact name (A1), and remembers the match; no match is a sync issue naming the
   * company, since guessing a contact would put a bill against the wrong party.
   */
  async function pushSource(
    scope: TenantScope,
    provider: AccountingProviderKey,
    src: LedgerSourceInput,
  ): Promise<'skipped' | 'created' | 'updated' | 'locked' | 'issue'> {
    const row = await find(scope, provider);
    if (!row || row.status !== 'active') return 'skipped';
    const reference = `PC-${src.contractNumber}-${src.claimNumber}`;
    const wanted = src.kind === 'bill' ? row.settings.pushBills : row.settings.pushInvoices;
    if (!wanted || (row.settings.startDate && src.date < row.settings.startDate)) return 'skipped';
    if (!src.counterparty) {
      await raise(
        scope,
        row.id,
        'no_contact',
        `${reference} has no ${src.kind === 'bill' ? 'subcontractor' : 'client'} company set on its contract.`,
        reference,
      );
      return 'issue';
    }
    const role = src.kind === 'bill' ? 'supplier' : 'customer';
    const company = src.counterparty;
    let contactRemoteId: string | undefined;
    try {
      const [known] = await scope.tx
        .select({ remoteId: accountingContacts.remoteId })
        .from(accountingContacts)
        .where(
          and(
            eq(accountingContacts.connectionId, row.id),
            eq(accountingContacts.companyId, company.companyId),
            eq(accountingContacts.role, role),
          ),
        )
        .limit(1);
      contactRemoteId = known?.remoteId;
      if (!contactRemoteId) {
        const found = await providerFor(scope, row).findContact(
          { abn: company.abn, name: company.name },
          role,
        );
        if (!found) {
          await raise(
            scope,
            row.id,
            'no_contact',
            `No ${role} matching ${company.name}${company.abn ? ` (ABN ${company.abn})` : ''} in the accounting system. Add or fix it there, then retry.`,
            reference,
          );
          return 'issue';
        }
        contactRemoteId = found.remoteId;
        await scope.tx
          .insert(accountingContacts)
          .values({
            id: uuidv7(),
            orgId: scope.ctx.orgId,
            connectionId: row.id,
            companyId: company.companyId,
            role,
            remoteId: found.remoteId,
            matchedBy: found.matchedBy,
          })
          .onConflictDoNothing();
      }
    } catch (e) {
      return failure(scope, row, e, reference);
    }
    return push(scope, provider, {
      localType: src.localType,
      localId: src.localId,
      document: {
        kind: src.kind,
        reference,
        contactRemoteId,
        date: src.date,
        dueDate: src.dueDate,
        lines: src.lines.map((l) => ({
          description: l.description,
          costCode: l.code,
          amountCents: l.amountCents,
          gstCents: l.gstCents,
        })),
        retentionCents: src.retentionCents,
        status: row.settings.billStatus,
      },
    });
  }

  /**
   * Pulls payments on documents we pushed (A7) and stores new ones. Returns the new payments, each with the local claim
   * or payment schedule it belongs to when exactly one pushed document carries its reference, so the caller (the
   * claims module) can record them. Re-running never duplicates a payment. A reversal is kept only when the payment it
   * undoes was seen before. A reference that matches several documents (the same `PC-` number in two projects) is a
   * sync issue, not a guess.
   */
  async function pullPayments(
    scope: TenantScope,
    provider: AccountingProviderKey,
  ): Promise<PulledPayment[]> {
    const row = await find(scope, provider);
    if (!row || row.status !== 'active') return [];
    const since = row.lastPulledAt ?? new Date(0);
    const started = now();
    const payments = await providerFor(scope, row).paymentsSince(since);
    const fresh: PulledPayment[] = [];
    for (const p of payments) {
      if (p.reverses) {
        const [original] = await scope.tx
          .select({ id: accountingPayments.id })
          .from(accountingPayments)
          .where(
            and(
              eq(accountingPayments.connectionId, row.id),
              eq(accountingPayments.remoteId, p.reverses),
            ),
          )
          .limit(1);
        if (!original) continue;
      }
      const inserted = await scope.tx
        .insert(accountingPayments)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          connectionId: row.id,
          remoteId: p.remoteId,
          reference: p.documentReference,
          paidOn: p.paidOn,
          amountCents: p.amountCents,
        })
        .onConflictDoNothing()
        .returning({ id: accountingPayments.id });
      if (!inserted.length) continue;
      const docs = await scope.tx
        .select({ localType: accountingDocuments.localType, localId: accountingDocuments.localId })
        .from(accountingDocuments)
        .where(
          and(
            eq(accountingDocuments.connectionId, row.id),
            eq(accountingDocuments.reference, p.documentReference),
          ),
        )
        .limit(2);
      if (docs.length > 1)
        await raise(
          scope,
          row.id,
          'rejected',
          `A payment of ${p.amountCents / 100} on ${p.documentReference} was not recorded: that reference matches more than one claim. Record it by hand.`,
          p.documentReference,
        );
      fresh.push(docs.length === 1 ? { ...p, local: docs[0]! } : p);
    }
    await scope.tx
      .update(accountingConnections)
      .set({ lastPulledAt: started })
      .where(eq(accountingConnections.id, row.id));
    return fresh;
  }

  const issues = (scope: TenantScope, status: 'open' | 'resolved' = 'open') =>
    scope.tx
      .select()
      .from(accountingSyncIssues)
      .where(eq(accountingSyncIssues.status, status))
      .orderBy(desc(accountingSyncIssues.createdAt))
      .limit(200);

  async function resolveIssue(scope: TenantScope, userId: string, id: string) {
    const [row] = await scope.tx
      .update(accountingSyncIssues)
      .set({ status: 'resolved', resolvedAt: now(), resolvedBy: userId })
      .where(eq(accountingSyncIssues.id, id))
      .returning();
    if (!row) throw new AppError('sync_issue.not_found');
    return row;
  }

  return {
    list,
    start,
    prepareCallback,
    exchange,
    finishCallback,
    targets,
    abandonCallback,
    selectTarget,
    disconnect,
    setFieldMap,
    setSettings,
    push,
    pushSource,
    pullPayments,
    issues,
    resolveIssue,
  };
}

/** A pulled payment and, when one pushed document matches its reference, the local record it is against. */
export type PulledPayment = RemotePayment & {
  local?: { localType: 'payment_schedule' | 'claim'; localId: string };
};

export type AccountingService = ReturnType<typeof createAccountingService>;
