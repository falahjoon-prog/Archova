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
import type { AgendaSection, ItemKind, ItemStatus, SeriesTemplate } from '../domain/minutes';

export const meetingsSchema = pgSchema('meetings');

export interface DefaultAttendee {
  name: string;
  companyName: string;
  role: string;
  email: string | null;
  userId: string | null;
  companyId: string | null;
}
export type Attendance = 'present' | 'apologies' | 'absent';
export type LinkType = 'rfi' | 'variation' | 'defect';

export const series = meetingsSchema.table('series', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  template: text('template').$type<SeriesTemplate>().notNull().default('custom'),
  cadence: text('cadence'),
  defaultAttendees: jsonb('default_attendees').$type<DefaultAttendee[]>().notNull().default([]),
  agenda: jsonb('agenda').$type<AgendaSection[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const meetings = meetingsSchema.table('meetings', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  seriesId: uuid('series_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  heldAt: timestamp('held_at', { withTimezone: true }).notNull(),
  location: text('location').notNull().default(''),
  chairUserId: uuid('chair_user_id'),
  status: text('status').$type<'draft' | 'issued'>().notNull().default('draft'),
  correctionsBy: date('corrections_by'),
  issuedVersion: integer('issued_version').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const attendees = meetingsSchema.table('attendees', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  meetingId: uuid('meeting_id').notNull(),
  position: integer('position').notNull(),
  name: text('name').notNull(),
  companyName: text('company_name').notNull().default(''),
  role: text('role').notNull().default(''),
  email: text('email'),
  userId: uuid('user_id'),
  companyId: uuid('company_id'),
  attendance: text('attendance').$type<Attendance>().notNull().default('present'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sections = meetingsSchema.table('sections', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  meetingId: uuid('meeting_id').notNull(),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  internalOnly: boolean('internal_only').notNull().default(false),
  nextItem: integer('next_item').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const items = meetingsSchema.table('items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  meetingId: uuid('meeting_id').notNull(),
  sectionId: uuid('section_id').notNull(),
  threadId: uuid('thread_id').notNull(),
  carriedFromId: uuid('carried_from_id'),
  carriedCount: integer('carried_count').notNull().default(0),
  itemNo: text('item_no').notNull(),
  seq: integer('seq').notNull(),
  kind: text('kind').$type<ItemKind>().notNull(),
  body: text('body').notNull(),
  status: text('status').$type<ItemStatus>().notNull().default('open'),
  ownerCompanyId: uuid('owner_company_id'),
  ownerUserId: uuid('owner_user_id'),
  ownerName: text('owner_name'),
  dueDate: date('due_date'),
  linkedType: text('linked_type').$type<LinkType>(),
  linkedId: text('linked_id'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const versions = meetingsSchema.table('versions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  meetingId: uuid('meeting_id').notNull(),
  version: integer('version').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  issuedBy: uuid('issued_by'),
  correctionsBy: date('corrections_by'),
  note: text('note'),
  recipients: jsonb('recipients').$type<{ name: string; email: string }[]>().notNull().default([]),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
});
