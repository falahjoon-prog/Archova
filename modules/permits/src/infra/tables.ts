import { date, integer, pgSchema, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { Lifecycle, PermitKind } from '../domain/permit';

export const permitsSchema = pgSchema('permits');

export const permits = permitsSchema.table('permits', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  kind: text('kind').$type<PermitKind>().notNull(),
  title: text('title').notNull(),
  issuingAuthority: text('issuing_authority'),
  referenceNumber: text('reference_number'),
  holderCompanyId: uuid('holder_company_id'),
  issuedOn: date('issued_on'),
  expiresOn: date('expires_on'),
  lifecycle: text('lifecycle').$type<Lifecycle>().notNull().default('active'),
  renewalStartedOn: date('renewal_started_on'),
  notes: text('notes'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const requirements = permitsSchema.table(
  'requirements',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').$type<PermitKind>().notNull(),
    leadDays: integer('lead_days').notNull().default(30),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [unique().on(t.projectId, t.kind)],
);

export const permitEvents = permitsSchema.table('permit_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  permitId: uuid('permit_id').notNull(),
  action: text('action').notNull(),
  fromLifecycle: text('from_lifecycle'),
  toLifecycle: text('to_lifecycle').notNull(),
  expiresOn: date('expires_on'),
  note: text('note'),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
