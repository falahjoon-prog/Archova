import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bookmarksSchema = pgSchema('bookmarks');

/** The kinds of record a person can bookmark; the API turns the id into a public id of this kind. */
export const BOOKMARK_ENTITIES = [
  'rfi',
  'submittal',
  'defect',
  'drawing_sheet',
  'meeting',
] as const;
export type BookmarkEntity = (typeof BOOKMARK_ENTITIES)[number];

export const bookmarks = bookmarksSchema.table('bookmarks', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  projectId: uuid('project_id').notNull(),
  entityType: text('entity_type').$type<BookmarkEntity>().notNull(),
  entityId: uuid('entity_id').notNull(),
  title: text('title').notNull(),
  subtitle: text('subtitle').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
