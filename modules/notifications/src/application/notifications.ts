import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7, type IdKind } from '@archova/domain';
import type { Notification, NotificationList } from '@archova/contracts';
import { AppError, type TenantScope } from '@archova/kernel';
import { notifications, type NotificationEntity } from '../infra/tables';

/** One thing to tell one person. `dedupeKey` is unique per recipient: telling them twice is a no-op. */
export interface NewNotification {
  userId: string;
  projectId: string | null;
  kind: string;
  entityType: NotificationEntity;
  entityId: string;
  title: string;
  body?: string;
  dedupeKey: string;
}

const ENTITY_KIND: Record<NotificationEntity, IdKind> = {
  meeting: 'meeting',
  tender_package: 'tenderPackage',
  contract: 'contract',
  incident: 'incident',
  compliance_document: 'complianceDocument',
  conversation: 'conversation',
  warranty_item: 'warrantyItem',
  announcement: 'announcement',
  permit: 'permit',
  cover: 'cover',
  defect: 'defect',
};

type Row = typeof notifications.$inferSelect;

function toApi(r: Row): Notification {
  return {
    id: encodeId('notification', r.id),
    kind: r.kind,
    title: r.title,
    body: r.body,
    entityType: r.entityType,
    entityId: encodeId(ENTITY_KIND[r.entityType], r.entityId),
    projectId: r.projectId ? encodeId('project', r.projectId) : null,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Adds notifications inside the caller's transaction and returns how many were new. Safe to call twice with the
 * same keys, which is what lets a scheduled reminder job be idempotent.
 */
export async function createNotifications(
  scope: TenantScope,
  rows: readonly NewNotification[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await scope.tx
    .insert(notifications)
    .values(
      rows.map((r) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        userId: r.userId,
        projectId: r.projectId,
        kind: r.kind,
        entityType: r.entityType,
        entityId: r.entityId,
        title: r.title,
        body: r.body ?? '',
        dedupeKey: r.dedupeKey,
      })),
    )
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
    .returning({ id: notifications.id });
  return inserted.length;
}

export interface NotificationService {
  list(scope: TenantScope, opts: { limit: number }): Promise<NotificationList>;
  markRead(scope: TenantScope, publicId: string): Promise<Notification>;
  markAllRead(scope: TenantScope): Promise<void>;
}

/** The inbox is private: every query is for the caller's own rows, so another person's id is simply "not found". */
export function createNotificationService(now: () => Date = () => new Date()): NotificationService {
  const mine = (scope: TenantScope) =>
    and(eq(notifications.orgId, scope.ctx.orgId), eq(notifications.userId, scope.ctx.userId));

  return {
    async list(scope, { limit }) {
      const rows = await scope.tx
        .select()
        .from(notifications)
        .where(mine(scope))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit);
      const [{ n } = { n: 0 }] = await scope.tx
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(mine(scope), isNull(notifications.readAt)));
      return { data: rows.map(toApi), unreadCount: n };
    },

    async markRead(scope, publicId) {
      const id = decodeId('notification', publicId);
      if (!id) throw new AppError('notification.not_found');
      const [row] = await scope.tx
        .update(notifications)
        .set({
          readAt: sql`coalesce(${notifications.readAt}, ${now().toISOString()}::timestamptz)`,
        })
        .where(and(mine(scope), eq(notifications.id, id)))
        .returning();
      if (!row) throw new AppError('notification.not_found');
      return toApi(row);
    },

    async markAllRead(scope) {
      await scope.tx
        .update(notifications)
        .set({ readAt: now() })
        .where(and(mine(scope), isNull(notifications.readAt)));
    },
  };
}
