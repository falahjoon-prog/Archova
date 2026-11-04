import { date, integer, jsonb, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { SwmsContent, SwmsStatus } from '../domain/swms';

export const safetySchema = pgSchema('safety');

export const swms = safetySchema.table('swms', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  companyId: uuid('company_id'),
  highRiskWorkCategories: text('high_risk_work_categories').array().notNull().default([]),
  content: jsonb('content').$type<SwmsContent>().notNull().default({}),
  fileId: uuid('file_id'),
  revision: integer('revision').notNull().default(1),
  status: text('status').$type<SwmsStatus>().notNull().default('submitted'),
  reviewedBy: uuid('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  expiresOn: date('expires_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const swmsEvents = safetySchema.table('swms_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  swmsId: uuid('swms_id').notNull(),
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  revision: integer('revision').notNull(),
  note: text('note'),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const acknowledgements = safetySchema.table(
  'swms_acknowledgements',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    swmsId: uuid('swms_id').notNull(),
    revision: integer('revision').notNull(),
    userId: uuid('user_id').notNull(),
    workerName: text('worker_name').notNull(),
    language: text('language').notNull().default('en'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.swmsId, t.revision, t.userId)],
);
