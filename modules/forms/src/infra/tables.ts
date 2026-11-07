import { date, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Answers, FieldDef, SubmissionStatus } from '../domain/forms';

export const formsSchema = pgSchema('forms');

export const templates = formsSchema.table('templates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  version: integer('version').notNull().default(1),
  status: text('status').$type<'draft' | 'published' | 'archived'>().notNull().default('draft'),
  fields: jsonb('fields').$type<FieldDef[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const submissions = formsSchema.table('submissions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  templateId: uuid('template_id').notNull(),
  templateVersion: integer('template_version').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  status: text('status').$type<SubmissionStatus>().notNull().default('assigned'),
  assigneeId: uuid('assignee_id'),
  dueDate: date('due_date'),
  answers: jsonb('answers').$type<Answers>().notNull().default({}),
  fileIds: uuid('file_ids').array().notNull().default([]),
  relatedType: text('related_type').$type<'incident'>(),
  relatedId: uuid('related_id'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: uuid('closed_by'),
});
