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

export const drainGrants = syncSchema.table('drain_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  projectId: uuid('project_id'),
  module: text('module'),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const lateSubmissions = syncSchema.table('late_submissions', {
  id: uuid('id').notNull().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  mutationId: uuid('mutation_id').notNull(),
  grantId: uuid('grant_id').notNull(),
  projectId: uuid('project_id').notNull(),
  module: text('module').notNull(),
  command: text('command').notNull(),
  entityId: text('entity_id').notNull(),
  baseVersion: integer('base_version'),
  clientAt: timestamp('client_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb('payload').$type<Record<string, unknown> | null>(),
  status: text('status').$type<'pending' | 'accepted' | 'rejected'>().notNull().default('pending'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  acceptedVersion: integer('accepted_version'),
});
