import { and, desc, eq, exists, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { IdentityApi } from '@archova/mod-identity';
import { createNotifications } from '@archova/mod-notifications';
import type { PlatformApi } from '@archova/mod-platform';
import {
  BODY_MAX,
  READ_BY_MAX_HOURS,
  TITLE_MAX,
  cleanBody,
  cleanTitle,
  dueAt,
  previewOf,
  recentlyNudged,
  resolveAudience,
  unreadFlags,
  type Audience,
  type UnreadFlag,
} from '../domain/announcements';
import { announcements, recipients, type AnnouncementPriority } from '../infra/tables';

export type AnnouncementRow = typeof announcements.$inferSelect;
export type RecipientRow = typeof recipients.$inferSelect;
export type Names = Map<string, string>;

export interface AnnouncementsDeps {
  platform: Pick<PlatformApi, 'getProject' | 'listActiveMembers'>;
  identity: Pick<IdentityApi, 'getUsers'>;
  access: Pick<AccessService, 'can'>;
  now?: () => Date;
}

export interface CreateInput {
  title: string;
  body: string;
  priority?: AnnouncementPriority;
  audience: Audience;
  keyUserIds?: readonly string[];
  readByHours?: number | null;
}

/** What the caller may see of an announcement: its receipts only when they sent it or manage the project. */
export interface View {
  announcement: AnnouncementRow;
  /** The caller's own receipt; null for the sender (and managers who were not recipients). */
  mine: RecipientRow | null;
  counts: { recipientCount: number; readCount: number };
  canSeeReceipts: boolean;
}

export function createAnnouncementsService(deps: AnnouncementsDeps) {
  const now = deps.now ?? (() => new Date());

  async function names(ids: readonly string[]): Promise<Names> {
    const users = await deps.identity.getUsers([...new Set(ids)]);
    return new Map([...users].map(([id, u]) => [id, u.name || u.email]));
  }

  function badText(path: 'title' | 'body', max: number): never {
    throw new AppError('validation_failed', `Enter between 1 and ${max} characters.`, [
      { path, message: `Enter between 1 and ${max} characters` },
    ]);
  }

  const canManage = (scope: TenantScope, projectId: string) =>
    deps.access.can(scope, 'announcements.announcements.manage', { projectId });

  /** Announcements the caller may see: ones they sent or received; managers see every one on the project. */
  async function visibleCondition(scope: TenantScope, projectId: string): Promise<SQL | undefined> {
    if (await canManage(scope, projectId)) return undefined;
    return or(
      eq(announcements.createdBy, scope.ctx.userId),
      exists(
        scope.tx
          .select({ one: sql`1` })
          .from(recipients)
          .where(
            and(
              eq(recipients.announcementId, announcements.id),
              eq(recipients.userId, scope.ctx.userId),
            ),
          ),
      ),
    );
  }

  async function views(
    scope: TenantScope,
    projectId: string,
    rows: readonly AnnouncementRow[],
  ): Promise<View[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const manager = await canManage(scope, projectId);
    const counts = await scope.tx
      .select({
        announcementId: recipients.announcementId,
        total: sql<number>`count(*)::int`,
        read: sql<number>`count(${recipients.readAt})::int`,
      })
      .from(recipients)
      .where(inArray(recipients.announcementId, ids))
      .groupBy(recipients.announcementId);
    const mine = await scope.tx
      .select()
      .from(recipients)
      .where(and(inArray(recipients.announcementId, ids), eq(recipients.userId, scope.ctx.userId)));
    const countOf = new Map(counts.map((c) => [c.announcementId, c]));
    const mineOf = new Map(mine.map((m) => [m.announcementId, m]));
    return rows.map((announcement) => {
      const c = countOf.get(announcement.id);
      return {
        announcement,
        mine: mineOf.get(announcement.id) ?? null,
        counts: { recipientCount: c?.total ?? 0, readCount: c?.read ?? 0 },
        canSeeReceipts: manager || announcement.createdBy === scope.ctx.userId,
      };
    });
  }

  async function getRow(scope: TenantScope, projectId: string, id: string) {
    const visible = await visibleCondition(scope, projectId);
    const [row] = await scope.tx
      .select()
      .from(announcements)
      .where(
        and(
          eq(announcements.id, id),
          eq(announcements.projectId, projectId),
          ...(visible ? [visible] : []),
        ),
      )
      .limit(1);
    // Someone it was not sent to gets "not found", never a hint that it exists.
    if (!row) throw new AppError('announcement.not_found');
    return row;
  }

  /** Newest first, with the caller's unread count for the project. */
  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { limit: number; cursor?: string; unreadOnly?: boolean },
  ) {
    await deps.platform.getProject(scope, projectId);
    const after = decodeCursor<{ t: string; id: string }>(opts.cursor);
    const visible = await visibleCondition(scope, projectId);
    const conditions: SQL[] = [eq(announcements.projectId, projectId)];
    if (visible) conditions.push(visible);
    if (opts.unreadOnly)
      conditions.push(
        exists(
          scope.tx
            .select({ one: sql`1` })
            .from(recipients)
            .where(
              and(
                eq(recipients.announcementId, announcements.id),
                eq(recipients.userId, scope.ctx.userId),
                isNull(recipients.readAt),
              ),
            ),
        ),
      );
    if (after) {
      const t = new Date(after.t);
      conditions.push(
        or(
          lt(announcements.createdAt, t),
          and(eq(announcements.createdAt, t), lt(announcements.id, after.id)),
        )!,
      );
    }
    const rows = await scope.tx
      .select()
      .from(announcements)
      .where(and(...conditions))
      .orderBy(desc(announcements.createdAt), desc(announcements.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ t: r.createdAt.toISOString(), id: r.id }));
    const items = await views(scope, projectId, page.data);
    const [{ n } = { n: 0 }] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(recipients)
      .where(
        and(
          eq(recipients.projectId, projectId),
          eq(recipients.userId, scope.ctx.userId),
          isNull(recipients.readAt),
        ),
      );
    const senders = await names(items.map((v) => v.announcement.createdBy));
    return { data: items, names: senders, nextCursor: page.nextCursor, unreadCount: n };
  }

  /** One announcement. The sender and managers also get the per-person receipts and Nova's overdue flags. */
  async function detail(scope: TenantScope, projectId: string, id: string) {
    const row = await getRow(scope, projectId, id);
    const [view] = await views(scope, projectId, [row]);
    const base = {
      view: view!,
      receipts: null as null | RecipientRow[],
      flags: [] as UnreadFlag[],
    };
    if (!view!.canSeeReceipts) {
      return { ...base, names: await names([row.createdBy]) };
    }
    const receipts = await scope.tx
      .select()
      .from(recipients)
      .where(eq(recipients.announcementId, id))
      .orderBy(recipients.id);
    const flags = unreadFlags(receipts, row.createdAt, row.readByHours, now());
    return {
      ...base,
      receipts,
      flags,
      names: await names([row.createdBy, ...receipts.map((r) => r.userId)]),
    };
  }

  async function create(scope: TenantScope, projectId: string, input: CreateInput) {
    await deps.platform.getProject(scope, projectId);
    const title = cleanTitle(input.title) ?? badText('title', TITLE_MAX);
    const body = cleanBody(input.body) ?? badText('body', BODY_MAX);
    const readByHours = input.readByHours ?? null;
    if (readByHours !== null && (readByHours < 1 || readByHours > READ_BY_MAX_HOURS))
      throw new AppError('validation_failed', 'Choose a read-by window of 1 to 720 hours.', [
        { path: 'readByHours', message: 'Between 1 and 720 hours' },
      ]);
    if (
      input.audience.kind === 'group' &&
      input.audience.companyIds.length === 0 &&
      input.audience.userIds.length === 0
    )
      throw new AppError('announcement.audience_empty', 'Choose who this announcement is for.');

    const members = await deps.platform.listActiveMembers(scope, projectId);
    const to = resolveAudience(members, input.audience, scope.ctx.userId);
    if (to.length === 0)
      throw new AppError(
        'announcement.audience_empty',
        'Nobody else on the project matches that audience.',
      );
    const keys = [...new Set(input.keyUserIds ?? [])];
    const toSet = new Set(to);
    if (keys.some((k) => !toSet.has(k)))
      throw new AppError(
        'validation_failed',
        'Key people must be among the people it is sent to.',
        [{ path: 'keyUserIds', message: 'Not in the audience' }],
      );

    const id = uuidv7();
    const at = now();
    await scope.tx.insert(announcements).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      title,
      body,
      priority: input.priority ?? 'normal',
      audienceKind: input.audience.kind,
      audienceCompanyIds: input.audience.kind === 'group' ? [...input.audience.companyIds] : [],
      audienceUserIds: input.audience.kind === 'group' ? [...input.audience.userIds] : [],
      readByHours,
      createdBy: scope.ctx.userId,
      createdAt: at,
    });
    const keySet = new Set(keys);
    await scope.tx.insert(recipients).values(
      to.map((userId) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        announcementId: id,
        projectId,
        userId,
        isKey: keySet.has(userId),
      })),
    );
    const sender = (await names([scope.ctx.userId])).get(scope.ctx.userId) ?? 'Someone';
    await createNotifications(
      scope,
      to.map((userId) => ({
        userId,
        projectId,
        kind: 'announcements.posted',
        entityType: 'announcement' as const,
        entityId: id,
        title: `${input.priority === 'important' ? 'Important: ' : ''}${title}`,
        body: `${sender}: ${previewOf(body, 200)}`,
        dedupeKey: `announcements.posted:${id}`,
      })),
    );
    scope.events.add({
      type: 'announcements.announcement.posted.v1',
      projectId,
      entityType: 'announcement',
      entityId: id,
      entityVersion: 1,
      data: { announcementId: id, recipientCount: to.length },
    });
    return detail(scope, projectId, id);
  }

  /** Marks the caller's copy read. Idempotent: the first read time is kept. */
  async function markRead(scope: TenantScope, projectId: string, id: string) {
    const row = await getRow(scope, projectId, id);
    await scope.tx
      .update(recipients)
      .set({ readAt: sql`coalesce(${recipients.readAt}, ${now().toISOString()}::timestamptz)` })
      .where(and(eq(recipients.announcementId, row.id), eq(recipients.userId, scope.ctx.userId)));
    return detail(scope, projectId, id);
  }

  /**
   * Sends a reminder to people the sender chose after seeing Nova's flags. Only unread recipients are nudged, and
   * not twice inside the cooldown, so a repeat click is harmless.
   */
  async function nudge(
    scope: TenantScope,
    projectId: string,
    id: string,
    userIds: readonly string[],
  ) {
    const row = await getRow(scope, projectId, id);
    const manager = await canManage(scope, projectId);
    if (row.createdBy !== scope.ctx.userId && !manager)
      throw new AppError(
        'access.denied',
        'Only the sender or a project manager can send a reminder.',
      );
    const wanted = [...new Set(userIds)];
    const rows = wanted.length
      ? await scope.tx
          .select()
          .from(recipients)
          .where(and(eq(recipients.announcementId, id), inArray(recipients.userId, wanted)))
      : [];
    if (rows.length !== wanted.length)
      throw new AppError('validation_failed', 'You can only remind people it was sent to.', [
        { path: 'userIds', message: 'Not a recipient' },
      ]);
    const at = now();
    const targets = rows.filter((r) => r.readAt === null && !recentlyNudged(r.nudgedAt, at));
    for (const r of targets) {
      await scope.tx
        .update(recipients)
        .set({ nudgedAt: at, nudgeCount: sql`${recipients.nudgeCount} + 1` })
        .where(eq(recipients.id, r.id));
    }
    const sender = (await names([scope.ctx.userId])).get(scope.ctx.userId) ?? 'Someone';
    await createNotifications(
      scope,
      targets.map((r) => ({
        userId: r.userId,
        projectId,
        kind: 'announcements.nudge',
        entityType: 'announcement' as const,
        entityId: id,
        title: `Please read: ${row.title}`,
        body: `${sender} is waiting for you to read this announcement.`,
        dedupeKey: `announcements.nudge:${id}:${r.nudgeCount + 1}`,
      })),
    );
    return { nudged: targets.length, skipped: rows.length - targets.length };
  }

  return { list, detail, create, markRead, nudge, dueAt };
}

export type AnnouncementsService = ReturnType<typeof createAnnouncementsService>;
