import { integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const conversationsSchema = pgSchema('conversations');

export const threads = conversationsSchema.table('threads', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  subject: text('subject').notNull(),
  messageCount: integer('message_count').notNull().default(1),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
});

export const messages = conversationsSchema.table('messages', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  threadId: uuid('thread_id').notNull(),
  projectId: uuid('project_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
