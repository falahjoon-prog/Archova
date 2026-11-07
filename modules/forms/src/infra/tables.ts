import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { Answers, FormCategory, FormField, LinkModule } from '../domain/fields';

export const formsSchema = pgSchema('forms');

export const templates = formsSchema.table('templates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').$type<FormCategory>().notNull().default('general'),
  fields: jsonb('fields').$type<FormField[]>().notNull().default([]),
  linkModule: text('link_module').$type<LinkModule>(),
  cadenceDays: integer('cadence_days'),
  copiedFrom: text('copied_from'),
  status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const forms = formsSchema.table('forms', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  templateRef: text('template_ref').notNull(),
  templateName: text('template_name').notNull(),
  category: text('category').$type<FormCategory>().notNull(),
  linkModule: text('link_module').$type<LinkModule>(),
  fields: jsonb('fields').$type<FormField[]>().notNull(),
  title: text('title').notNull(),
  answers: jsonb('answers').$type<Answers>().notNull().default({}),
  status: text('status').$type<'draft' | 'submitted'>().notNull().default('draft'),
  formDate: text('form_date').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const signatures = formsSchema.table('signatures', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  formId: uuid('form_id').notNull(),
  fieldKey: text('field_key').notNull(),
  signerName: text('signer_name').notNull(),
  signerKey: text('signer_key').notNull(),
  signerUserId: uuid('signer_user_id'),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
});
