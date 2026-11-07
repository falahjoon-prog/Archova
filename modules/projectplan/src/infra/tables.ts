import { date, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ItemStatus, ItemType, Party, PlanLink } from '../domain/plan';

export const projectplanSchema = pgSchema('projectplan');

export interface StoredReference {
  label: string;
  url: string | null;
  fileId: string | null;
}
export type StoredLink = Pick<PlanLink, 'type' | 'id' | 'label'> & { ref: string };

export const phases = projectplanSchema.table('phases', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const items = projectplanSchema.table('items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  phaseId: uuid('phase_id').notNull(),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  outcome: text('outcome').notNull().default(''),
  itemTypes: text('item_types').array().$type<ItemType[]>().notNull().default([]),
  dueDate: date('due_date'),
  status: text('status').$type<ItemStatus>().notNull().default('not_started'),
  parties: jsonb('parties').$type<Party[]>().notNull().default([]),
  referenceDocs: jsonb('reference_docs').$type<StoredReference[]>().notNull().default([]),
  links: jsonb('links').$type<StoredLink[]>().notNull().default([]),
  note: text('note'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedBy: uuid('completed_by'),
  holdClearedAt: timestamp('hold_cleared_at', { withTimezone: true }),
  holdClearedBy: uuid('hold_cleared_by'),
  holdNote: text('hold_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const requests = projectplanSchema.table('requests', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  itemId: uuid('item_id').notNull(),
  kind: text('kind').$type<'attachment' | 'photo'>().notNull(),
  message: text('message').notNull().default(''),
  assigneeUserId: uuid('assignee_user_id'),
  status: text('status').$type<'open' | 'fulfilled' | 'cancelled'>().notNull().default('open'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  requestedBy: uuid('requested_by'),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  fulfilledBy: uuid('fulfilled_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
