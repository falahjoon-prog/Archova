import { date, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { StepKind, SubmittalStatus, SubmittalType } from '../domain/submittal';

export const submittalsSchema = pgSchema('submittals');

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

export const submittals = submittalsSchema.table('submittals', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  numberLabel: text('number_label').notNull(),
  title: text('title').notNull(),
  type: text('type').$type<SubmittalType>().notNull(),
  specSection: text('spec_section'),
  responsibleCompanyId: uuid('responsible_company_id'),
  managerId: uuid('manager_id'),
  requiredOnSite: date('required_on_site'),
  leadTimeDays: integer('lead_time_days').notNull().default(0),
  reviewDays: integer('review_days').notNull().default(10),
  submitBy: date('submit_by'),
  status: text('status').$type<SubmittalStatus>().notNull(),
  currentRevision: integer('current_revision').notNull().default(0),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type RevisionStatus =
  'in_review' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected';

export const revisions = submittalsSchema.table('revisions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  submittalId: uuid('submittal_id').notNull(),
  revision: integer('revision').notNull(),
  submittedBy: uuid('submitted_by'),
  submittedByCompanyId: uuid('submitted_by_company_id'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  note: text('note').notNull().default(''),
  fileIds: uuid('file_ids').array().notNull().default([]),
  status: text('status').$type<RevisionStatus>().notNull().default('in_review'),
  returnedAt: timestamp('returned_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const steps = submittalsSchema.table('steps', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  submittalId: uuid('submittal_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  step: integer('step').notNull(),
  kind: text('kind').$type<StepKind>().notNull(),
  approverUserId: uuid('approver_user_id').notNull(),
  companyId: uuid('company_id'),
  dueDate: date('due_date'),
  response: text('response')
    .$type<
      | 'pending'
      | 'forwarded'
      | 'approved'
      | 'approved_as_noted'
      | 'revise_resubmit'
      | 'rejected'
      | 'skipped'
    >()
    .notNull()
    .default('pending'),
  comments: text('comments').notNull().default(''),
  fileIds: uuid('file_ids').array().notNull().default([]),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  respondedBy: uuid('responded_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
