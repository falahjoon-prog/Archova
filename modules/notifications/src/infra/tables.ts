import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const notificationsSchema = pgSchema('notifications');

/** What a notification points at; the API turns the id into a public id of this kind. */
export type NotificationEntity =
  | 'meeting'
  | 'tender_package'
  | 'contract'
  | 'incident'
  | 'compliance_document'
  | 'conversation'
  | 'form_submission';

export const notifications = notificationsSchema.table('notifications', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  projectId: uuid('project_id'),
  kind: text('kind').notNull(),
  entityType: text('entity_type').$type<NotificationEntity>().notNull(),
  entityId: uuid('entity_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  dedupeKey: text('dedupe_key').notNull(),
  readAt: timestamp('read_at', { withTimezone: true }),
  /** When the worker claimed it for email; null when not emailed. */
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
