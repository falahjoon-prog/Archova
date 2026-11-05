import {
  boolean,
  date,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Answers, PrequalStatus, Question } from '../domain/prequal';

export const preconSchema = pgSchema('precon');

export const templates = preconSchema.table('prequal_templates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  version: integer('version').notNull().default(1),
  published: boolean('published').notNull().default(false),
  validityMonths: integer('validity_months').notNull().default(12),
  questions: jsonb('questions').$type<Question[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  rowVersion: integer('row_version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const prequalifications = preconSchema.table('prequalifications', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  companyId: uuid('company_id').notNull(),
  templateId: uuid('template_id').notNull(),
  templateVersion: integer('template_version').notNull(),
  status: text('status').$type<PrequalStatus>().notNull().default('draft'),
  trades: text('trades').array().notNull().default([]),
  answers: jsonb('answers').$type<Answers>().notNull().default({}),
  scorePoints: integer('score_points'),
  scoreMax: integer('score_max'),
  concerns: text('concerns').array().notNull().default([]),
  submittedBy: uuid('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  decidedBy: uuid('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note'),
  validFrom: date('valid_from', { mode: 'string' }),
  expiresOn: date('expires_on', { mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const settings = preconSchema.table('settings', {
  orgId: uuid('org_id').primaryKey(),
  requireForTenders: boolean('require_for_tenders').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});
