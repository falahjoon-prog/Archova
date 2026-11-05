import { bigint, date, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const ownerportalSchema = pgSchema('ownerportal');

export type MilestoneStatus = 'done' | 'on_track' | 'at_risk' | 'late';
export interface Milestone {
  name: string;
  date: string | null;
  status: MilestoneStatus;
}

export const progressUpdates = ownerportalSchema.table('progress_updates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  title: text('title').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  summary: text('summary').notNull().default(''),
  percentComplete: integer('percent_complete').notNull(),
  milestones: jsonb('milestones').$type<Milestone[]>().notNull().default([]),
  status: text('status').$type<'draft' | 'published'>().notNull().default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export type ApprovalStatus = 'requested' | 'approved' | 'rejected' | 'withdrawn';

export const approvals = ownerportalSchema.table('approvals', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  amountCents: bigint('amount_cents', { mode: 'number' }),
  dueDate: date('due_date'),
  status: text('status').$type<ApprovalStatus>().notNull().default('requested'),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const capitalItems = ownerportalSchema.table('capital_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  fiscalYear: integer('fiscal_year').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull().default(''),
  budgetCents: bigint('budget_cents', { mode: 'number' }).notNull(),
  forecastCents: bigint('forecast_cents', { mode: 'number' }).notNull(),
  spentCents: bigint('spent_cents', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
