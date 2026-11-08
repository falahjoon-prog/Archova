import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const recentsSchema = pgSchema('recents');

/** The kinds of record whose views are remembered; the API turns the id into a public id of this kind. */
export const RECENT_ENTITIES = ['rfi', 'submittal', 'defect', 'drawing_sheet', 'meeting'] as const;
export type RecentEntity = (typeof RECENT_ENTITIES)[number];

export const recentViews = recentsSchema.table('recent_views', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  projectId: uuid('project_id').notNull(),
  entityType: text('entity_type').$type<RecentEntity>().notNull(),
  entityId: uuid('entity_id').notNull(),
  title: text('title').notNull(),
  subtitle: text('subtitle').notNull().default(''),
  viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
});
