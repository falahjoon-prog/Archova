import {
  boolean,
  date,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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

export type RiskCategory =
  'scope' | 'time' | 'cost' | 'quality' | 'safety' | 'commercial' | 'other';
export type RiskStatus = 'open' | 'mitigating' | 'occurred' | 'closed';

export const risks = reportingSchema.table('risks', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').$type<RiskCategory>().notNull(),
  likelihood: smallint('likelihood').notNull(),
  impact: smallint('impact').notNull(),
  status: text('status').$type<RiskStatus>().notNull().default('open'),
  ownerName: text('owner_name'),
  mitigation: text('mitigation').notNull().default(''),
  reviewDate: date('review_date'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
