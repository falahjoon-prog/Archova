import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { StepDef } from '../domain/workflow';

export const workflowsSchema = pgSchema('workflows');

export type SubjectType = 'financials.variation';
export type RunStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const definitions = workflowsSchema.table('definitions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  subjectType: text('subject_type').$type<SubjectType>().notNull(),
  name: text('name').notNull(),
  minAmount: numeric('min_amount', { precision: 18, scale: 2 }),
  steps: jsonb('steps').$type<StepDef[]>().notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const runs = workflowsSchema.table('runs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  definitionId: uuid('definition_id').notNull(),
  subjectType: text('subject_type').$type<SubjectType>().notNull(),
  subjectId: uuid('subject_id').notNull(),
  steps: jsonb('steps').$type<StepDef[]>().notNull(),
  currentStep: integer('current_step'),
  status: text('status').$type<RunStatus>().notNull().default('pending'),
  startedBy: uuid('started_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const runDecisions = workflowsSchema.table('run_decisions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  runId: uuid('run_id').notNull(),
  stepIndex: integer('step_index').notNull(),
  userId: uuid('user_id').notNull(),
  decision: text('decision').$type<'approved' | 'rejected'>().notNull(),
  note: text('note'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});
