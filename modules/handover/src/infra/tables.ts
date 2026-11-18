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
import type { HandoverCategory, HandoverStatus } from '../domain/handover';

export const handoverSchema = pgSchema('handover');

export const items = handoverSchema.table('items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  category: text('category').$type<HandoverCategory>().notNull(),
  title: text('title').notNull(),
  description: text('description'),
  required: boolean('required').notNull().default(true),
  status: text('status').$type<HandoverStatus>().notNull().default('outstanding'),
  responsibleCompanyId: uuid('responsible_company_id'),
  dueOn: date('due_on'),
  receivedOn: date('received_on'),
  approvedOn: date('approved_on'),
  approvedBy: uuid('approved_by'),
  note: text('note'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const itemEvents = handoverSchema.table('item_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  itemId: uuid('item_id').notNull(),
  action: text('action').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status').notNull(),
  note: text('note'),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export interface IssueSnapshotItem {
  numberLabel: string;
  category: HandoverCategory;
  title: string;
  required: boolean;
  status: HandoverStatus;
  files: { id: string; filename: string; sizeBytes: number }[];
}

export const issues = handoverSchema.table('issues', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  recipientName: text('recipient_name').notNull(),
  note: text('note'),
  incompleteCount: integer('incomplete_count').notNull().default(0),
  snapshot: jsonb('snapshot').$type<{ items: IssueSnapshotItem[] }>().notNull(),
  issuedBy: uuid('issued_by'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
});
