import { boolean, date, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ReportConfig } from '../domain/report';

export const reportingSchema = pgSchema('reporting');

export const reports = reportingSchema.table('reports', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  shared: boolean('shared').notNull().default(false),
  config: jsonb('config').$type<ReportConfig>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const dashboardSnapshots = reportingSchema.table('dashboard_snapshots', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  title: text('title').notNull(),
  currentAsOf: date('current_as_of').notNull(),
  program: text('program'),
  data: jsonb('data').$type<unknown>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
