import { pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const linksSchema = pgSchema('links');

export const links = linksSchema.table('links', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  fromType: text('from_type').notNull(),
  fromId: uuid('from_id').notNull(),
  toType: text('to_type').notNull(),
  toId: uuid('to_id').notNull(),
  reason: text('reason').notNull(),
  note: text('note'),
  origin: text('origin').notNull().default('user'),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
