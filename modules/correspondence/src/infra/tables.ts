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
import type { CorrespondenceStatus, RelatedLink } from '../domain/correspondence';

export const correspondenceSchema = pgSchema('correspondence');

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

export const types = correspondenceSchema.table('types', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  description: text('description').notNull().default(''),
  templateKey: text('template_key'),
  isEvidential: boolean('is_evidential').notNull().default(false),
  responseRequired: boolean('response_required').notNull().default(false),
  responseDays: integer('response_days').notNull().default(10),
  timeBarDays: integer('time_bar_days'),
  subjectTemplate: text('subject_template').notNull().default(''),
  bodyTemplate: text('body_template').notNull().default(''),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...audit,
});

export const items = correspondenceSchema.table('items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  typeId: uuid('type_id').notNull(),
  typeName: text('type_name').notNull(),
  isEvidential: boolean('is_evidential').notNull(),
  number: integer('number').notNull(),
  numberLabel: text('number_label').notNull(),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  status: text('status').$type<CorrespondenceStatus>().notNull().default('draft'),
  fromCompanyId: uuid('from_company_id'),
  toCompanyIds: uuid('to_company_ids').array().notNull().default([]),
  responseRequired: boolean('response_required').notNull().default(false),
  dueDate: date('due_date'),
  eventDate: date('event_date'),
  timeBarDays: integer('time_bar_days'),
  timeBarDate: date('time_bar_date'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  related: jsonb('related').$type<RelatedLink[]>().notNull().default([]),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  sentBy: uuid('sent_by'),
  contentHash: text('content_hash'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  voidReason: text('void_reason'),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const responses = correspondenceSchema.table('responses', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  itemId: uuid('item_id').notNull(),
  authorId: uuid('author_id').notNull(),
  authorCompanyId: uuid('author_company_id'),
  body: text('body').notNull(),
  fileIds: uuid('file_ids').array().notNull().default([]),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});
export const itemEmails = correspondenceSchema.table('item_emails', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  itemId: uuid('item_id').notNull(),
  senderId: uuid('sender_id').notNull(),
  recipientUserId: uuid('recipient_user_id').notNull(),
  message: text('message').notNull().default(''),
  status: text('status')
    .$type<'queued' | 'sending' | 'sent' | 'failed'>()
    .notNull()
    .default('queued'),
  attempts: integer('attempts').notNull().default(0),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
});
