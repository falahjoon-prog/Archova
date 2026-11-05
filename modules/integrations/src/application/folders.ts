import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type TenantContext, type TenantScope } from '@archova/kernel';
import type { PlatformApi } from '@archova/mod-platform';
import type { FilesModule } from '@archova/mod-files';
import type { FetchLike } from '../domain/accounting';
import { createTokenSession } from '../domain/accounting';
import type { TokenVault } from '../domain/accounting';
import {
  FolderProviderError,
  MAX_PUBLISH_BYTES,
  adminConsentUrl,
  appToken,
  createDriveProvider,
  createGraphProvider,
  googleAuthorizeUrl,
  googleExchangeCode,
  googleRefresh,
  newGooglePkce,
  publishedFileName,
  type FolderProvider,
  type FolderProviderName,
  type GoogleCredentials,
  type GoogleTokens,
  type M365Credentials,
} from '../domain/folders';
import { folderConnections, folderLinks, folderPublished } from '../infra/tables';

export type FolderConnectionRow = typeof folderConnections.$inferSelect;
export type FolderLinkRow = typeof folderLinks.$inferSelect;

export interface FoldersDeps {
  vault: TokenVault;
  fetch: FetchLike;
  /** `{redirectBase}/{provider}/callback` is the address registered with Google and Microsoft. */
  redirectBase: string;
  credentials: { m365: M365Credentials | null; google: GoogleCredentials | null };
  platform: Pick<PlatformApi, 'getProject'>;
  files: Pick<FilesModule['api'], 'readFileBytes'>;
  /** Tests and local development: a provider that never calls out. Real providers are used when absent. */
  providerOverride?: (provider: FolderProviderName) => FolderProvider;
  now?: () => Date;
}

export interface PublishedRevision {
  projectId: string;
  sheetId: string;
  revisionId: string;
  sheetNumber: string;
  rev: string;
  previousRevisionId: string | null;
  fileId: string;
}

const STATE_TTL_MS = 10 * 60_000;
const NAMES = { m365: 'Microsoft 365', google: 'Google Drive' } as const;
const SUPERSEDED = 'Superseded';

export function createFoldersService(deps: FoldersDeps) {
  const now = () => (deps.now ?? (() => new Date()))();

  const creds = (p: FolderProviderName) => {
    const c = deps.credentials[p];
    if (!c && !deps.providerOverride)
      throw new AppError(
        'folders.not_configured',
        `${NAMES[p]} is not set up on this installation yet.`,
      );
    return c;
  };
  const redirectUri = (p: FolderProviderName) => `${deps.redirectBase}/${p}/callback`;

  function audit(
    scope: TenantScope,
    action: 'connected' | 'disconnected' | 'linked' | 'unlinked' | 'published' | 'publish_failed',
    entityType: 'folder_connection' | 'folder_link',
    entityId: string,
    data: Record<string, unknown>,
    projectId?: string,
  ) {
    scope.events.add({
      type: `integrations.folders.${action}.v1`,
      ...(projectId ? { projectId } : {}),
      entityType,
      entityId,
      entityVersion: null,
      data,
    });
  }

  const find = async (scope: TenantScope, provider: FolderProviderName) =>
    (
      await scope.tx
        .select()
        .from(folderConnections)
        .where(eq(folderConnections.provider, provider))
    )[0] ?? null;
  async function require(scope: TenantScope, provider: FolderProviderName) {
    const row = await find(scope, provider);
    if (!row) throw new AppError('folders.not_found');
    return row;
  }
  const list = (scope: TenantScope) =>
    scope.tx.select().from(folderConnections).orderBy(folderConnections.provider);

  /**
   * Step 1. Google: PKCE sign-in with `drive.file`. Microsoft: the admin-consent address for the customer's tenant;
   * `tenantId` is the Entra tenant (a GUID or a verified domain) the admin is consenting for.
   */
  async function start(
    scope: TenantScope,
    userId: string,
    provider: FolderProviderName,
    input: { tenantId?: string },
  ) {
    const c = creds(provider);
    const state = randomBytes(24).toString('base64url');
    const pkce = provider === 'google' ? newGooglePkce() : null;
    if (provider === 'm365' && !input.tenantId)
      throw new AppError('validation_failed', 'Enter the Microsoft tenant id.', [
        { path: 'tenantId', message: 'Required for Microsoft 365' },
      ]);
    const values = {
      status: 'pending' as const,
      oauthState: state,
      oauthStateAt: now(),
      verifierSealed: pkce
        ? deps.vault.seal(scope.ctx.orgId, 'oauth-verifier', pkce.verifier)
        : null,
      tenantRef: provider === 'm365' ? input.tenantId! : null,
      lastError: null,
      updatedAt: now(),
    };
    const existing = await find(scope, provider);
    if (existing) {
      await scope.tx
        .update(folderConnections)
        .set(existing.status === 'active' ? { ...values, status: 'active' as const } : values)
        .where(eq(folderConnections.id, existing.id));
    } else {
      await scope.tx
        .insert(folderConnections)
        .values({ id: uuidv7(), orgId: scope.ctx.orgId, provider, createdBy: userId, ...values });
    }
    const url =
      provider === 'google'
        ? googleAuthorizeUrl({
            clientId: (c as GoogleCredentials | null)?.clientId ?? 'dev',
            redirectUri: redirectUri(provider),
            state,
            challenge: pkce!.challenge,
          })
        : adminConsentUrl({
            tenantId: input.tenantId!,
            clientId: (c as M365Credentials | null)?.clientId ?? 'dev',
            redirectUri: redirectUri(provider),
            state,
          });
    return { url };
  }

  /** Step 2a (no transaction open): the state matches a fresh pending connection. */
  async function prepareCallback(scope: TenantScope, provider: FolderProviderName, state: string) {
    const row = await require(scope, provider);
    const fresh = row.oauthStateAt && now().getTime() - row.oauthStateAt.getTime() <= STATE_TTL_MS;
    if (!row.oauthState || row.oauthState !== state || !fresh)
      throw new AppError('folders.bad_state', 'This sign-in link has expired. Start again.');
    return {
      verifier: row.verifierSealed
        ? deps.vault.open(scope.ctx.orgId, 'oauth-verifier', row.verifierSealed)
        : null,
      tenantId: row.tenantRef,
    };
  }

  async function abandonCallback(scope: TenantScope, provider: FolderProviderName, state: string) {
    await scope.tx
      .update(folderConnections)
      .set({ oauthState: null, oauthStateAt: null, verifierSealed: null, updatedAt: now() })
      .where(
        and(eq(folderConnections.provider, provider), eq(folderConnections.oauthState, state)),
      );
  }

  /** Step 2b (no transaction open): proves the grant works. Google trades the code; Microsoft gets an app token. */
  async function exchange(
    provider: FolderProviderName,
    p: { code?: string; verifier: string | null; tenantId: string | null },
  ): Promise<{ tokens: GoogleTokens | null }> {
    if (deps.providerOverride) return { tokens: null };
    try {
      if (provider === 'google') {
        if (!p.code || !p.verifier) throw new AppError('folders.bad_state', 'Sign in again.');
        const tokens = await googleExchangeCode(
          deps.fetch,
          creds('google') as GoogleCredentials,
          { code: p.code, redirectUri: redirectUri('google'), verifier: p.verifier },
          () => now().getTime(),
        );
        return { tokens };
      }
      // Consent is per tenant; being able to mint a token for it is the proof.
      await appToken(deps.fetch, creds('m365') as M365Credentials, p.tenantId!, () =>
        now().getTime(),
      );
      return { tokens: null };
    } catch (e) {
      if (e instanceof FolderProviderError)
        throw new AppError('folders.provider_error', `${NAMES[provider]} refused the sign-in.`);
      throw e;
    }
  }

  async function finishCallback(
    scope: TenantScope,
    provider: FolderProviderName,
    state: string,
    result: { tokens: GoogleTokens | null },
  ) {
    const row = await require(scope, provider);
    if (row.oauthState !== state)
      throw new AppError('folders.bad_state', 'This sign-in link has expired. Start again.');
    const [saved] = await scope.tx
      .update(folderConnections)
      .set({
        status: 'active',
        oauthState: null,
        oauthStateAt: null,
        verifierSealed: null,
        tokensSealed: result.tokens
          ? deps.vault.seal(scope.ctx.orgId, 'oauth-tokens', JSON.stringify(result.tokens))
          : null,
        lastError: null,
        updatedAt: now(),
      })
      .where(eq(folderConnections.id, row.id))
      .returning();
    audit(scope, 'connected', 'folder_connection', row.id, { provider, userId: scope.ctx.userId });
    return saved!;
  }

  async function disconnect(scope: TenantScope, provider: FolderProviderName) {
    const row = await require(scope, provider);
    const links = await scope.tx
      .select({ id: folderLinks.id })
      .from(folderLinks)
      .where(eq(folderLinks.connectionId, row.id));
    for (const l of links) {
      await scope.tx.delete(folderPublished).where(eq(folderPublished.linkId, l.id));
    }
    await scope.tx.delete(folderLinks).where(eq(folderLinks.connectionId, row.id));
    await scope.tx.delete(folderConnections).where(eq(folderConnections.id, row.id));
    // Files already in SharePoint or Drive stay where they are.
    audit(scope, 'disconnected', 'folder_connection', row.id, {
      provider,
      userId: scope.ctx.userId,
    });
  }

  /** A provider whose token refreshes itself. Google refresh tokens do not rotate, so nothing is written back. */
  function providerFor(orgId: string, row: FolderConnectionRow): FolderProvider {
    if (deps.providerOverride) return deps.providerOverride(row.provider);
    if (row.provider === 'm365') {
      const c = creds('m365') as M365Credentials;
      let cached: { accessToken: string; expiresAt: number } | null = null;
      const token = async () => {
        if (!cached || cached.expiresAt - now().getTime() < 60_000)
          cached = await appToken(deps.fetch, c, row.tenantRef!, () => now().getTime());
        return cached.accessToken;
      };
      return createGraphProvider(token, deps.fetch);
    }
    const c = creds('google') as GoogleCredentials;
    if (!row.tokensSealed)
      throw new FolderProviderError('google', 401, 'auth', false, 'Not signed in');
    const initial = JSON.parse(
      deps.vault.open(orgId, 'oauth-tokens', row.tokensSealed),
    ) as GoogleTokens;
    const session = createTokenSession(
      initial,
      (refresh) => googleRefresh(deps.fetch, c, refresh, () => now().getTime()),
      async () => {},
      () => now().getTime(),
    );
    return createDriveProvider(session, deps.fetch);
  }

  // ---- project links -------------------------------------------------------------------------------------

  const links = (scope: TenantScope, projectId: string) =>
    scope.tx.select().from(folderLinks).where(eq(folderLinks.projectId, projectId));

  /** Step 1 of linking (read-only): the connection must be active; returns what the provider call needs. */
  async function prepareLink(scope: TenantScope, projectId: string, provider: FolderProviderName) {
    const project = await deps.platform.getProject(scope, projectId);
    const conn = await require(scope, provider);
    if (conn.status !== 'active')
      throw new AppError('folders.not_ready', `Connect ${NAMES[provider]} first.`);
    const [dup] = await scope.tx
      .select({ id: folderLinks.id })
      .from(folderLinks)
      .where(and(eq(folderLinks.projectId, projectId), eq(folderLinks.connectionId, conn.id)));
    if (dup)
      throw new AppError(
        'folders.already_linked',
        'This project is already linked to that account.',
      );
    return { connection: conn, projectName: project.name };
  }

  /** Step 2 (no transaction open): resolve or create the remote folder and its `Superseded` subfolder. */
  async function resolveRemote(
    orgId: string,
    conn: FolderConnectionRow,
    input: { url?: string; projectName: string },
  ) {
    const provider = providerFor(orgId, conn);
    try {
      const target = await provider.resolveTarget(input);
      const sup = await provider.ensureSubfolder(target, SUPERSEDED);
      return { target, supersededId: sup.folderId };
    } catch (e) {
      if (e instanceof FolderProviderError) {
        if (e.kind === 'bad_target') throw new AppError('folders.bad_target', e.message);
        throw new AppError(
          'folders.provider_error',
          `${NAMES[conn.provider]} did not accept that folder.`,
        );
      }
      throw e;
    }
  }

  async function createLink(
    scope: TenantScope,
    userId: string,
    projectId: string,
    conn: FolderConnectionRow,
    remote: Awaited<ReturnType<typeof resolveRemote>>,
  ) {
    const [row] = await scope.tx
      .insert(folderLinks)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        connectionId: conn.id,
        remoteDriveId: remote.target.driveId,
        remoteFolderId: remote.target.folderId,
        remoteSupersededId: remote.supersededId,
        remoteName: remote.target.name,
        remoteWebUrl: remote.target.webUrl,
        createdBy: userId,
      })
      .returning();
    audit(scope, 'linked', 'folder_link', row!.id, { provider: conn.provider, userId }, projectId);
    return row!;
  }

  async function removeLink(scope: TenantScope, projectId: string, linkId: string) {
    const [l] = await scope.tx
      .select()
      .from(folderLinks)
      .where(and(eq(folderLinks.id, linkId), eq(folderLinks.projectId, projectId)));
    if (!l) throw new AppError('folders.link_not_found');
    await scope.tx.delete(folderPublished).where(eq(folderPublished.linkId, l.id));
    await scope.tx.delete(folderLinks).where(eq(folderLinks.id, l.id));
    audit(scope, 'unlinked', 'folder_link', l.id, { userId: scope.ctx.userId }, projectId);
  }

  // ---- publish ---------------------------------------------------------------------------------------------

  /**
   * One-way publish of a newly current drawing revision to every active link on its project. The slow provider calls run
   * between transactions, so no connection is held while a drawing uploads. Safe to repeat: a revision already published
   * to a link is skipped, and an upload replaces a file of the same name. A retryable provider error is thrown for the
   * dispatcher; anything that needs a person is stored on the link instead.
   */
  async function publishRevision(database: Database, ctx: TenantContext, rev: PublishedRevision) {
    const plan = await database.withTenantTx(
      ctx,
      async (scope) => {
        const rows = await scope.tx
          .select({ link: folderLinks, conn: folderConnections })
          .from(folderLinks)
          .innerJoin(folderConnections, eq(folderConnections.id, folderLinks.connectionId))
          .where(eq(folderLinks.projectId, rev.projectId));
        const todo: {
          link: FolderLinkRow;
          conn: FolderConnectionRow;
          previous: { id: string; remoteId: string } | null;
        }[] = [];
        for (const r of rows) {
          if (r.conn.status !== 'active') continue;
          const [done] = await scope.tx
            .select({ id: folderPublished.id })
            .from(folderPublished)
            .where(
              and(
                eq(folderPublished.linkId, r.link.id),
                eq(folderPublished.revisionId, rev.revisionId),
              ),
            );
          if (done) continue;
          let previous: { id: string; remoteId: string } | null = null;
          if (rev.previousRevisionId) {
            const [p] = await scope.tx
              .select({ id: folderPublished.id, remoteId: folderPublished.remoteId })
              .from(folderPublished)
              .where(
                and(
                  eq(folderPublished.linkId, r.link.id),
                  eq(folderPublished.revisionId, rev.previousRevisionId),
                  eq(folderPublished.state, 'current'),
                ),
              );
            previous = p ?? null;
          }
          todo.push({ link: r.link, conn: r.conn, previous });
        }
        if (!todo.length) return null;
        try {
          const { file, bytes } = await deps.files.readFileBytes(
            scope,
            rev.fileId,
            MAX_PUBLISH_BYTES,
          );
          return { todo, file, bytes, tooLarge: false };
        } catch (e) {
          if (e instanceof AppError && e.code === 'validation_failed')
            return { todo, file: null, bytes: null, tooLarge: true };
          throw e;
        }
      },
      { readOnly: true },
    );
    if (!plan) return { published: 0 };

    const results: {
      linkId: string;
      remoteId?: string;
      fileName?: string;
      previous: { id: string; remoteId: string } | null;
      error?: { message: string; fatal: boolean };
    }[] = [];
    let retry: unknown = null;
    for (const t of plan.todo) {
      if (plan.tooLarge || !plan.file || !plan.bytes) {
        results.push({
          linkId: t.link.id,
          previous: t.previous,
          error: { message: 'This drawing is over 100 MB, so it was not published.', fatal: false },
        });
        continue;
      }
      const fileName = publishedFileName(rev.sheetNumber, rev.rev, plan.file.filename);
      try {
        const provider = providerFor(ctx.orgId, t.conn);
        const parent = { driveId: t.link.remoteDriveId, folderId: t.link.remoteFolderId };
        const up = await provider.uploadFile(parent, {
          name: fileName,
          contentType: (plan.file as { mime?: string }).mime ?? 'application/pdf',
          bytes: plan.bytes,
        });
        if (t.previous) {
          await provider
            .moveFile(
              t.link.remoteDriveId,
              t.previous.remoteId,
              t.link.remoteFolderId,
              t.link.remoteSupersededId,
            )
            .catch((e) => {
              // A previous file someone deleted in SharePoint is not our problem (integrations/03 §4).
              if (!(e instanceof FolderProviderError && e.kind === 'missing')) throw e;
            });
        }
        results.push({ linkId: t.link.id, remoteId: up.remoteId, fileName, previous: t.previous });
      } catch (e) {
        if (!(e instanceof FolderProviderError)) throw e;
        if (e.retryable) {
          retry = e;
          continue;
        }
        results.push({
          linkId: t.link.id,
          previous: t.previous,
          error: {
            message:
              e.kind === 'auth'
                ? `${NAMES[t.conn.provider]} refused access. An admin must reconnect it.`
                : e.kind === 'missing'
                  ? 'The linked folder no longer exists. Unlink it and link a new one.'
                  : `${NAMES[t.conn.provider]} rejected the upload.`,
            fatal: e.kind === 'auth',
          },
        });
      }
    }

    let published = 0;
    await database.withTenantTx(ctx, async (scope) => {
      for (const r of results) {
        if (r.error) {
          await scope.tx
            .update(folderLinks)
            .set({ status: 'error', lastError: r.error.message })
            .where(eq(folderLinks.id, r.linkId));
          if (r.error.fatal) {
            const link = plan.todo.find((t) => t.link.id === r.linkId)!;
            await scope.tx
              .update(folderConnections)
              .set({ status: 'error', lastError: r.error.message, updatedAt: now() })
              .where(eq(folderConnections.id, link.conn.id));
          }
          audit(
            scope,
            'publish_failed',
            'folder_link',
            r.linkId,
            { revisionId: rev.revisionId, message: r.error.message },
            rev.projectId,
          );
          continue;
        }
        await scope.tx.insert(folderPublished).values({
          id: uuidv7(),
          orgId: ctx.orgId,
          linkId: r.linkId,
          sheetId: rev.sheetId,
          revisionId: rev.revisionId,
          fileName: r.fileName!,
          remoteId: r.remoteId!,
        });
        if (r.previous)
          await scope.tx
            .update(folderPublished)
            .set({ state: 'superseded' })
            .where(eq(folderPublished.id, r.previous.id));
        await scope.tx
          .update(folderLinks)
          .set({ status: 'active', lastError: null, lastPublishedAt: now() })
          .where(eq(folderLinks.id, r.linkId));
        audit(
          scope,
          'published',
          'folder_link',
          r.linkId,
          { revisionId: rev.revisionId, sheetNumber: rev.sheetNumber, rev: rev.rev },
          rev.projectId,
        );
        published++;
      }
    });
    // Recorded what succeeded first; now let the dispatcher retry the rest.
    if (retry) throw retry;
    return { published };
  }

  return {
    list,
    start,
    prepareCallback,
    abandonCallback,
    exchange,
    finishCallback,
    disconnect,
    links,
    prepareLink,
    resolveRemote,
    createLink,
    removeLink,
    publishRevision,
  };
}

export type FoldersService = ReturnType<typeof createFoldersService>;
