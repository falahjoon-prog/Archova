import {
  bigint,
  date,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Lifecycle, CoverKind } from '../domain/cover';

export const insuranceSchema = pgSchema('insurance');

export const covers = insuranceSchema.table('covers', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  kind: text('kind').$type<CoverKind>().notNull(),
  title: text('title').notNull(),
  issuer: text('issuer'),
  referenceNumber: text('reference_number'),
  companyId: uuid('company_id').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }),
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

export const requirements = insuranceSchema.table(
  'requirements',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').$type<CoverKind>().notNull(),
    leadDays: integer('lead_days').notNull().default(30),
    minAmountCents: bigint('min_amount_cents', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [unique().on(t.projectId, t.kind)],
);

export const coverEvents = insuranceSchema.table('cover_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  coverId: uuid('cover_id').notNull(),
  action: text('action').notNull(),
  fromLifecycle: text('from_lifecycle'),
  toLifecycle: text('to_lifecycle').notNull(),
  expiresOn: date('expires_on'),
  note: text('note'),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
