// Transmittals over an access link (X45, Sam security-licensing/11 §3). A recipient with no account opens the link
// from their email: that one click records the "opened" receipt. They can then download each item and acknowledge
// receipt. Viewing needs no code, so nothing here writes anything but receipts.
//
// The link and its browser session are checked on every request: not expired, not revoked, not used up, and the
// person who issued it must still be allowed to issue transmittals.
import { and, eq, isNull } from 'drizzle-orm';
import { encodeId } from '@archova/domain';
import {
  AppError,
  accessLinkState,
  accessTokenOrg,
  countAccessLinkUse,
  findAccessLink,
  findAccessLinkSession,
  openAccessLinkSession,
  type AccessLink,
  type AccessLinkSession,
  type Database,
  type Entitlements,
  type Logger,
  type RedisClient,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import { transmittalRecipients } from '../infra/tables';
import { TRANSMITTAL_LINK_ENTITY, type TransmittalService } from './transmittals';
import type { DocumentsContext } from './context';

export interface TransmittalLinkDeps {
  database: Database;
  transmittals: TransmittalService;
  c: DocumentsContext;
  platform: Pick<PlatformApi, 'getProject' | 'getOrg' | 'resolveTenantAccess'>;
  files: Pick<FilesModule['api'], 'downloadUrl'>;
  entitlements: (orgId: string) => Promise<Entitlements>;
  redis?: RedisClient | null;
  logger?: Pick<Logger, 'warn'>;
  now?: () => Date;
}

export interface RequestFacts {
  ip: string;
  userAgent: string | null;
  requestId: string;
}

const NIL_USER = '00000000-0000-0000-0000-000000000000';

export function createTransmittalLinkService(deps: TransmittalLinkDeps) {
  const now = deps.now ?? (() => new Date());
  const { database, transmittals } = deps;

  // Redis when there is one; otherwise this process counts, which is right for tests and a single host.
  const local = new Map<string, { n: number; until: number }>();
  async function bump(key: string, windowS: number, max: number, weight: number) {
    let n: number;
    if (deps.redis) {
      n = await deps.redis.incrby(key, weight);
      if (n === weight) await deps.redis.expire(key, windowS);
    } else {
      const t = now().getTime();
      const cur = local.get(key);
      const live = cur && cur.until > t ? cur : { n: 0, until: t + windowS * 1000 };
      live.n += weight;
      local.set(key, live);
      n = live.n;
      if (local.size > 5000) for (const [k, v] of local) if (v.until <= t) local.delete(k);
    }
    if (n > max) throw new AppError('access_link.rate_limited', 'Too many tries. Wait a minute.');
  }
  /** Sam 11 §6: token lookups per IP, 30 a minute and 300 an hour; unknown tokens count double. */
  async function limit(ip: string, weight: number) {
    await bump(`g:tlrl:m:${ip}`, 60, 30, weight);
    await bump(`g:tlrl:h:${ip}`, 3600, 300, weight);
  }

  const invalid = () =>
    new AppError('access_link.invalid', 'This link no longer works. Ask the sender for a new one.');

  async function baseContext(orgId: string, facts: RequestFacts): Promise<TenantContext> {
    return {
      orgId,
      userId: NIL_USER,
      principalType: 'external',
      orgRole: null,
      entitlements: await deps.entitlements(orgId),
      requestId: facts.requestId,
    };
  }

  const guestContext = (base: TenantContext, link: AccessLink): TenantContext => ({
    ...base,
    userId: link.id,
    actor: { type: 'link', linkId: link.id, subjectType: null, subjectId: null },
  });

  /** Sam 11 §2: a link dies with its creator's access. They must still be able to issue transmittals. */
  async function creatorStillAllowed(scope: TenantScope, link: AccessLink) {
    const access = await deps.platform.resolveTenantAccess(
      scope.ctx.orgId,
      link.createdBy,
      scope.ctx.requestId,
    );
    if (!access) return false;
    if (access.orgRole === 'owner' || access.orgRole === 'admin') return true;
    if (!link.projectId) return false;
    const asCreator: TenantScope = {
      ...scope,
      ctx: {
        ...scope.ctx,
        userId: link.createdBy,
        principalType: 'member',
        orgRole: access.orgRole,
        actor: undefined,
      },
    };
    return deps.c.access.can(asCreator, 'documents.transmittals.manage', {
      projectId: link.projectId,
    });
  }

  /** `opening` is the one place a used-up link is refused: `maxUses` counts openings and never ends a session. */
  async function usable(scope: TenantScope, link: AccessLink, opening = false) {
    if (link.entityType !== TRANSMITTAL_LINK_ENTITY || !link.projectId) throw invalid();
    const state = accessLinkState(link, now());
    if (state === 'revoked' || state === 'expired' || (state === 'used_up' && opening))
      throw invalid();
    if (!(await creatorStillAllowed(scope, link))) throw invalid();
    if (scope.ctx.entitlements.state === 'cancelled') throw invalid();
  }

  interface Resolved {
    ctx: TenantContext;
    link: AccessLink;
    session: AccessLinkSession;
    projectId: string;
    transmittalId: string;
  }

  const sessionRequired = () =>
    new AppError('access_link.session_required', 'Open your link again to continue.');

  async function resolve(
    cookie: string | undefined,
    facts: RequestFacts,
    opts: { write?: boolean; action?: string } = {},
  ): Promise<Resolved> {
    const orgId = cookie ? accessTokenOrg(cookie, 'lns') : null;
    if (!cookie || !orgId) {
      await limit(facts.ip, 2);
      throw sessionRequired();
    }
    const base = await baseContext(orgId, facts);
    const found = await database.withTenantTx(
      base,
      async (scope) => {
        const f = await findAccessLinkSession(scope, cookie, now());
        if (!f) return null;
        await usable(scope, f.link);
        return f;
      },
      { readOnly: true },
    );
    if (!found) {
      await limit(facts.ip, 2);
      throw sessionRequired();
    }
    await bump(`g:tlrl:s:${found.session.id}`, 3600, 600, 1);
    if (opts.action && !found.link.allowedActions.includes(opts.action)) throw invalid();
    if (opts.write && base.entitlements.state === 'read_only')
      throw new AppError('org.read_only', 'This site is read-only right now. Ask the sender.');
    return {
      ctx: guestContext(base, found.link),
      link: found.link,
      session: found.session,
      projectId: found.link.projectId!,
      transmittalId: found.link.entityId,
    };
  }

  async function recipientOf(scope: TenantScope, link: AccessLink) {
    const [r] = await scope.tx
      .select()
      .from(transmittalRecipients)
      .where(eq(transmittalRecipients.accessLinkId, link.id))
      .limit(1);
    if (!r) throw invalid();
    return r;
  }

  async function accessView(scope: TenantScope, link: AccessLink) {
    const projectId = link.projectId!;
    const t = await transmittals.getRow(scope, projectId, link.entityId);
    if (t.status !== 'sent') throw invalid();
    const [org, project, items, r] = await Promise.all([
      deps.platform.getOrg(scope),
      deps.platform.getProject(scope, projectId),
      transmittals.itemsOf(scope, projectId, t.id, { authorised: true }),
      recipientOf(scope, link),
    ]);
    return {
      transmittal: {
        number: t.number!,
        subject: t.subject,
        purpose: t.purpose,
        message: t.message,
        responseDue: t.responseDue,
        sentAt: t.sentAt!.toISOString(),
        fromOrg: org.name as string,
        projectName: (project as { name: string }).name,
      },
      items: items.map((i) => ({
        revisionType: i.revisionType,
        revisionId: encodeId(
          i.revisionType === 'document' ? 'revision' : 'drawingRevision',
          i.revisionId,
        ),
        title: i.title,
        number: i.number,
        rev: i.rev,
      })),
      recipient: {
        email: r.email,
        name: r.name,
        role: r.role,
        openedAt: r.openedAt?.toISOString() ?? null,
        downloadedAt: r.downloadedAt?.toISOString() ?? null,
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      },
      actions: link.allowedActions,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /** Each receipt time is set once; the first download or acknowledgement also counts as opened. */
  async function receipt(
    scope: TenantScope,
    link: AccessLink,
    event: 'opened' | 'downloaded' | 'acknowledged',
  ) {
    const r = await recipientOf(scope, link);
    const field = (
      { opened: 'openedAt', downloaded: 'downloadedAt', acknowledged: 'acknowledgedAt' } as const
    )[event];
    if (r[field]) return false;
    const t = now();
    await scope.tx
      .update(transmittalRecipients)
      .set({ [field]: t, ...(event !== 'opened' && !r.openedAt ? { openedAt: t } : {}) })
      .where(and(eq(transmittalRecipients.id, r.id), isNull(transmittalRecipients[field])));
    scope.events.add({
      type: `documents.transmittal.${event}.v1`,
      projectId: link.projectId,
      entityType: 'transmittal',
      entityId: link.entityId,
      data: { transmittalId: link.entityId, recipientId: r.id },
    });
    return true;
  }

  async function open(token: string, facts: RequestFacts) {
    const orgId = accessTokenOrg(token, 'arl');
    await limit(facts.ip, orgId ? 1 : 2);
    if (!orgId) throw invalid();
    const base = await baseContext(orgId, facts);
    const opened = await database.withTenantTx(base, async (scope) => {
      const link = await findAccessLink(scope, token);
      if (!link) return null;
      await usable(scope, link, true);
      await countAccessLinkUse(scope, link.id);
      const { token: cookie } = await openAccessLinkSession(scope, link, {
        ip: facts.ip,
        userAgent: facts.userAgent,
        now: now(),
      });
      await receipt({ ...scope, ctx: guestContext(base, link) }, link, 'opened');
      return { cookie, body: await accessView(scope, link) };
    });
    if (!opened) throw invalid();
    return opened;
  }

  async function view(cookie: string | undefined, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { action: 'view' });
    return database.withTenantTx(r.ctx, (scope) => accessView(scope, r.link), { readOnly: true });
  }

  async function acknowledge(cookie: string | undefined, facts: RequestFacts) {
    const r = await resolve(cookie, facts, { write: true, action: 'acknowledge' });
    return database.withTenantTx(r.ctx, async (scope) => {
      await receipt(scope, r.link, 'acknowledged');
      return accessView(scope, r.link);
    });
  }

  /** A short-lived signed URL for one item of this transmittal and nothing else (Sam 11 §3). */
  async function download(
    cookie: string | undefined,
    item: { revisionType: 'document' | 'drawing'; revisionId: string },
    facts: RequestFacts,
  ) {
    const r = await resolve(cookie, facts, { action: 'download' });
    return database.withTenantTx(r.ctx, async (scope) => {
      const items = await transmittals.itemsOf(scope, r.projectId, r.transmittalId, {
        authorised: true,
      });
      const found = items.find(
        (i) => i.revisionType === item.revisionType && i.revisionId === item.revisionId,
      );
      if (!found) throw new AppError('transmittal.item_not_found');
      const url = await deps.files.downloadUrl(scope, found.fileId, { authorised: true });
      await receipt(scope, r.link, 'downloaded');
      return { url: url.url, expiresAt: url.expiresAt.toISOString(), filename: found.title };
    });
  }

  return { open, view, acknowledge, download };
}

export type TransmittalLinkService = ReturnType<typeof createTransmittalLinkService>;
