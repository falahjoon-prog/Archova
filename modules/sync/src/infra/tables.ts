import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const syncSchema = pgSchema('sync');

export const mutations = syncSchema.table('mutations', {
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  mutationId: uuid('mutation_id').notNull(),
  command: text('command').notNull(),
  entityId: text('entity_id').notNull(),
  status: text('status').$type<'pending' | 'applied' | 'rejected'>().notNull(),
  version: integer('version'),
  problem: jsonb('problem').$type<{ code: string; detail?: string }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
