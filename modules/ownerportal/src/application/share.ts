// The client share link for a project (X45, Sam security-licensing/11). The builder issues a read-only link; the
// client opens it without an account and sees what the builder chose to publish: published progress updates,
// upcoming milestones, approved changes (no amounts) and picked progress photos.
//
// The link and its browser session are checked on every request: not expired, not revoked, not used up, the plan
// still includes the portal, and the person who issued it must still be allowed to manage the share link.
// Nothing here reads cost, budget, commitments, correspondence or any unpublished record.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { decodeId, encodeId } from '@archova/domain';
import {
  AppError,
  ACCESS_LINK_DEFAULT_DAYS,
  ACCESS_LINK_MAX_DAYS,
  accessLinkState,
  accessTokenOrg,
  countAccessLinkUse,
  createAccessLink,
  findAccessLink,
  findAccessLinkSession,
  getAccessLink,
  listAccessLinks,
  openAccessLinkSession,
  revokeAccessLink,
  type AccessLink,
  type Database,
  type Entitlements,
  type Logger,
  type MessageSender,
  type RedisClient,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { upcomingMilestones } from '../domain/share';
import { approvals, progressUpdates, sharedPhotos } from '../infra/tables';

export const PORTAL_LINK_ENTITY = 'owner_portal';
/** Its own cookie, so opening a portal link never replaces a tender, transmittal or induction session. */
export const PORTAL_LINK_COOKIE = '__Host-opk';
export const PORTAL_LINK_ACTIONS = ['view'] as const;
export const SHARE_PERMISSION = 'ownerportal.share.manage';
const PHOTOS_PER_LINK = 60;
const PHOTO_URL_TTL_S = 600;
const LINKS_PER_PROJECT = 50;

export interface PortalFiles {
  getFile(
    scope: TenantScope,
    fileId: string,
    opts?: { authorised?: boolean },
  ): Promise<{
    id: string;
    projectId: string | null;
    mime: string;
    filename: string;
    status: string;
    createdAt: Date;
    capturedAt?: Date | null;
  }>;
  downloadUrl(
    scope: TenantScope,
    fileId: string,
    opts?: { authorised?: boolean; expiresInS?: number },
  ): Promise<{ url: string; expiresAt: Date }>;
}

export interface ApprovedChange {
  number: number;
  title: string;
  description: string | null;
  timeImpactDays: number;
  approvedAt: Date | null;
}

export interface ShareDeps {
  database: Database;
  access: Pick<AccessService, 'can'>;
  platform: Pick<PlatformApi, 'getProject' | 'getOrg' | 'resolveTenantAccess'>;
  files: PortalFiles;
  /** Approved head-contract variations, no amounts (financials). Called only after the link is checked. */
  approvedChanges: (scope: TenantScope, projectId: string) => Promise<ApprovedChange[]>;
  entitlements: (orgId: string) => Promise<Entitlements>;
  messages?: MessageSender;
  baseUrl: string;
  senderName?: (userId: string) => Promise<string>;
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
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const day = (d: Date) => d.toISOString().slice(0, 10);

export function createShareService(deps: ShareDeps) {
  const now = deps.now ?? (() => new Date());
  const { database } = deps;

  // ------------------------------------------------------------------------------------------ the team's side

  const linkDto = (l: AccessLink) => ({
    id: encodeId('accessLink', l.id),
    label: l.label,
    recipientEmail: l.recipientEmail,
    state: accessLinkState(l, now()),
    expiresAt: l.expiresAt.toISOString(),
    useCount: l.useCount,
    lastUsedAt: l.lastUsedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    revokedAt: l.revokedAt?.toISOString() ?? null,
  });

  async function listLinks(scope: TenantScope, projectId: string) {
    const links = await listAccessLinks(scope, PORTAL_LINK_ENTITY, projectId);
    return { data: links.map(linkDto) };
  }

  /** Issues a link; the token is returned once and never stored (only its hash is). */
  async function issue(
    scope: TenantScope,
    projectId: string,
    input: { label?: string | null; recipientEmail?: string | null; expiresInDays?: number },
  ) {
    await deps.platform.getProject(scope, projectId);
    const email = input.recipientEmail?.trim() || null;
    if (email && !EMAIL.test(email))
      throw new AppError('validation_failed', 'That email address is not valid.', [
        { path: 'recipientEmail', message: 'Not a valid email address' },
      ]);
    const existing = await listAccessLinks(scope, PORTAL_LINK_ENTITY, projectId);
    if (existing.filter((l) => accessLinkState(l, now()) === 'active').length >= LINKS_PER_PROJECT)
      throw new AppError(
        'access_link.rate_limited',
        'This project has as many live client links as it can. Revoke one you no longer need.',
      );
    const days = Math.min(input.expiresInDays ?? ACCESS_LINK_DEFAULT_DAYS, ACCESS_LINK_MAX_DAYS);
    const expiresAt = new Date(now().getTime() + days * 86_400_000);
    const { link, token } = await createAccessLink(scope, {
      projectId,
      entityType: PORTAL_LINK_ENTITY,
      entityId: projectId,
      allowedActions: PORTAL_LINK_ACTIONS,
      label: input.label?.trim() || null,
      recipientEmail: email,
      expiresAt,
    });
    return { link, token, url: `${deps.baseUrl}/c/${token}`, email, expiresAt };
  }

  /** Emails the link after the issuing transaction has committed. A failed send never undoes the link. */
  async function deliver(
    scope: TenantScope,
    projectId: string,
    issued: { url: string; email: string | null; expiresAt: Date },
  ): Promise<boolean> {
    if (!issued.email || !deps.messages) return false;
    try {
      const [org, project, sender] = await Promise.all([
        deps.platform.getOrg(scope),
        deps.platform.getProject(scope, projectId),
        deps.senderName?.(scope.ctx.userId) ?? Promise.resolve('your builder'),
      ]);
      const name = oneLine((project as { name: string }).name);
      await deps.messages.email(issued.email, {
        subject: `${oneLine(org.name as string)}: progress on ${name}`,
        text: [
          `${oneLine(org.name as string)} has shared a progress view of ${name} with you.`,
          `Sent by ${oneLine(sender)}.`,
          '',
          `See photos, milestones and approved changes: ${issued.url}`,
          `This link is for ${issued.email} and works until ${day(issued.expiresAt)}. You don't need an account.`,
        ].join('\n'),
      });
      return true;
    } catch (e) {
      deps.logger?.warn({ err: e }, 'client portal link email failed');
      return false;
    }
  }

  async function revoke(scope: TenantScope, projectId: string, linkId: string) {
    const link = await getAccessLink(scope, linkId);
    if (!link || link.entityType !== PORTAL_LINK_ENTITY || link.entityId !== projectId)
      throw new AppError('access_link.not_found');
    return linkDto(await revokeAccessLink(scope, linkId));
  }

  // ---- photos the builder picked

  async function listPhotos(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select()
      .from(sharedPhotos)
      .where(eq(sharedPhotos.projectId, projectId))
      .orderBy(desc(sharedPhotos.addedAt))
      .limit(PHOTOS_PER_LINK);
    const data = [];
    for (const r of rows) {
      const f = await deps.files.getFile(scope, r.fileId);
      const u = await deps.files.downloadUrl(scope, r.fileId, { expiresInS: PHOTO_URL_TTL_S });
      data.push({
        fileId: encodeId('file', r.fileId),
        caption: r.caption,
        filename: f.filename,
        url: u.url,
        addedAt: r.addedAt.toISOString(),
      });
    }
    return { data };
  }

  async function addPhoto(
    scope: TenantScope,
    projectId: string,
    input: { fileId: string; caption?: string },
  ) {
    const fileId = decodeId('file', input.fileId);
    if (!fileId) throw new AppError('validation_failed', 'Invalid id');
    // The usual read check applies: you can only share a photo you can already see on this project.
    const f = await deps.files.getFile(scope, fileId);
    if (f.projectId !== projectId || !f.mime.startsWith('image/'))
      throw new AppError('validation_failed', 'Only photos from this project can be shared.', [
        { path: 'fileId', message: 'Not a photo on this project' },
      ]);
    if (f.status !== 'ready')
      throw new AppError('file.not_ready', 'This photo is not available yet.');
    const total = (
      await scope.tx
        .select({ id: sharedPhotos.fileId })
        .from(sharedPhotos)
        .where(eq(sharedPhotos.projectId, projectId))
        .limit(PHOTOS_PER_LINK + 1)
    ).length;
    if (total >= PHOTOS_PER_LINK)
      throw new AppError(
        'validation_failed',
        `The client view shows up to ${PHOTOS_PER_LINK} photos. Remove one first.`,
      );
    await scope.tx
      .insert(sharedPhotos)
      .values({
        orgId: scope.ctx.orgId,
        projectId,
        fileId,
        caption: (input.caption ?? '').trim().slice(0, 300),
        addedBy: scope.ctx.userId,
      })
      .onConflictDoUpdate({
        target: [sharedPhotos.orgId, sharedPhotos.fileId],
        set: { caption: (input.caption ?? '').trim().slice(0, 300) },
      });
    return listPhotos(scope, projectId);
  }

  async function removePhoto(scope: TenantScope, projectId: string, encodedFileId: string) {
    const fileId = decodeId('file', encodedFileId);
    if (!fileId) throw new AppError('validation_failed', 'Invalid id');
    await scope.tx
      .delete(sharedPhotos)
      .where(and(eq(sharedPhotos.projectId, projectId), eq(sharedPhotos.fileId, fileId)));
    return listPhotos(scope, projectId);
  }

  // ---------------------------------------------------------------------------- the client's side

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
    await bump(`g:oprl:m:${ip}`, 60, 30, weight);
    await bump(`g:oprl:h:${ip}`, 3600, 300, weight);
  }

  const invalid = () =>
    new AppError('access_link.invalid', 'This link no longer works. Ask the sender for a new one.');
  const sessionRequired = () =>
    new AppError('access_link.session_required', 'Open your link again to continue.');

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

  /** Sam 11 §2: a link dies with its creator's access. They must still be able to manage the share link. */
  async function creatorStillAllowed(scope: TenantScope, link: AccessLink) {
    const access = await deps.platform.resolveTenantAccess(
      scope.ctx.orgId,
      link.createdBy,
      scope.ctx.requestId,
    );
    if (!access || !link.projectId) return false;
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
    return deps.access.can(asCreator, SHARE_PERMISSION, { projectId: link.projectId });
  }

  async function usable(scope: TenantScope, link: AccessLink, opening = false) {
    if (
      link.entityType !== PORTAL_LINK_ENTITY ||
      !link.projectId ||
      link.entityId !== link.projectId
    )
      throw invalid();
    const state = accessLinkState(link, now());
    if (state === 'revoked' || state === 'expired' || (state === 'used_up' && opening))
      throw invalid();
    if (!scope.ctx.entitlements.modules.includes('ownerportal')) throw invalid();
    if (scope.ctx.entitlements.state === 'cancelled') throw invalid();
    if (!(await creatorStillAllowed(scope, link))) throw invalid();
  }

  /** What the client sees. Only published updates, picked photos and approved changes: never a draft or a figure. */
  async function accessView(scope: TenantScope, link: AccessLink) {
    const projectId = link.projectId!;
    const [org, project] = await Promise.all([
      deps.platform.getOrg(scope),
      deps.platform.getProject(scope, projectId),
    ]);
    const updates = await scope.tx
      .select()
      .from(progressUpdates)
      .where(and(eq(progressUpdates.projectId, projectId), eq(progressUpdates.status, 'published')))
      .orderBy(desc(progressUpdates.periodEnd), desc(progressUpdates.createdAt))
      .limit(6);
    const decided = await scope.tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.projectId, projectId), inArray(approvals.status, ['approved'])))
      .orderBy(asc(approvals.decidedAt))
      .limit(100);
    const variations = await deps.approvedChanges(scope, projectId);
    const photoRows = await scope.tx
      .select()
      .from(sharedPhotos)
      .where(eq(sharedPhotos.projectId, projectId))
      .orderBy(desc(sharedPhotos.addedAt))
      .limit(PHOTOS_PER_LINK);
    const photos = [];
    for (const r of photoRows) {
      try {
        const u = await deps.files.downloadUrl(scope, r.fileId, {
          authorised: true,
          expiresInS: PHOTO_URL_TTL_S,
        });
        photos.push({ caption: r.caption, url: u.url, addedAt: r.addedAt.toISOString() });
      } catch (e) {
        // A photo that was deleted or is still being scanned drops out; the rest of the page still loads.
        if (!(e instanceof AppError)) throw e;
      }
    }
    const latest = updates[0] ?? null;
    return {
      project: {
        name: (project as { name: string }).name,
        fromOrg: org.name as string,
        timezone: (project as { timezone: string }).timezone,
      },
      progress: latest
        ? {
            title: latest.title,
            periodStart: latest.periodStart,
            periodEnd: latest.periodEnd,
            percentComplete: latest.percentComplete,
            summary: latest.summary,
            publishedAt: latest.publishedAt?.toISOString() ?? null,
          }
        : null,
      milestones: latest ? upcomingMilestones(latest.milestones) : [],
      updates: updates.map((u) => ({
        title: u.title,
        periodStart: u.periodStart,
        periodEnd: u.periodEnd,
        percentComplete: u.percentComplete,
        summary: u.summary,
        publishedAt: u.publishedAt?.toISOString() ?? null,
      })),
      changes: [
        ...variations.map((v) => ({
          kind: 'variation' as const,
          reference: `VAR-${String(v.number).padStart(3, '0')}`,
          title: v.title,
          description: v.description ?? '',
          timeImpactDays: v.timeImpactDays,
          approvedAt: v.approvedAt?.toISOString() ?? null,
        })),
        ...decided.map((a) => ({
          kind: 'decision' as const,
          reference: `DEC-${String(a.number).padStart(3, '0')}`,
          title: a.title,
          description: a.description,
          timeImpactDays: 0,
          approvedAt: a.decidedAt?.toISOString() ?? null,
        })),
      ].sort((a, b) => (b.approvedAt ?? '').localeCompare(a.approvedAt ?? '')),
      photos,
      expiresAt: link.expiresAt.toISOString(),
    };
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
      const guest: TenantScope = { ...scope, ctx: guestContext(base, link) };
      return { cookie, body: await accessView(guest, link) };
    });
    if (!opened) throw invalid();
    return opened;
  }

  async function view(cookie: string | undefined, facts: RequestFacts) {
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
    await bump(`g:oprl:s:${found.session.id}`, 3600, 600, 1);
    if (!found.link.allowedActions.includes('view')) throw invalid();
    return database.withTenantTx(
      guestContext(base, found.link),
      (scope) => accessView(scope, found.link),
      { readOnly: true },
    );
  }

  return { listLinks, issue, deliver, revoke, listPhotos, addPhoto, removePhoto, open, view };
}

export type ShareService = ReturnType<typeof createShareService>;
