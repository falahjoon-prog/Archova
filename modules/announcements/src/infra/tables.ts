import { boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const announcementsSchema = pgSchema('announcements');

export type AnnouncementPriority = 'normal' | 'important';
export type AudienceKind = 'all' | 'group';

export const announcements = announcementsSchema.table('announcements', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  priority: text('priority').$type<AnnouncementPriority>().notNull().default('normal'),
  audienceKind: text('audience_kind').$type<AudienceKind>().notNull(),
  audienceCompanyIds: uuid('audience_company_ids').array().notNull().default([]),
  audienceUserIds: uuid('audience_user_ids').array().notNull().default([]),
  readByHours: integer('read_by_hours'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipients = announcementsSchema.table('recipients', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  announcementId: uuid('announcement_id').notNull(),
  projectId: uuid('project_id').notNull(),
  userId: uuid('user_id').notNull(),
  isKey: boolean('is_key').notNull().default(false),
  readAt: timestamp('read_at', { withTimezone: true }),
  nudgedAt: timestamp('nudged_at', { withTimezone: true }),
  nudgeCount: integer('nudge_count').notNull().default(0),
});
