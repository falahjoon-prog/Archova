import {
  boolean,
  date,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { DeclarationKind, Lifecycle } from '../domain/declaration';

export const declarationsSchema = pgSchema('declarations');

export const statements = declarationsSchema.table('statements', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  companyId: uuid('company_id').notNull(),
  kind: text('kind').$type<DeclarationKind>().notNull(),
  declarantName: text('declarant_name'),
  declarantPosition: text('declarant_position'),
  declaredOn: date('declared_on'),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to').notNull(),
  issuer: text('issuer'),
  referenceNumber: text('reference_number'),
  claimId: uuid('claim_id'),
  lifecycle: text('lifecycle').$type<Lifecycle>().notNull().default('accepted'),
  notes: text('notes'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  readByNova: boolean('read_by_nova').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const requirements = declarationsSchema.table(
  'requirements',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').$type<DeclarationKind>().notNull(),
    leadDays: integer('lead_days').notNull().default(30),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [unique().on(t.projectId, t.kind)],
);

export const statementEvents = declarationsSchema.table('statement_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  statementId: uuid('statement_id').notNull(),
  action: text('action').notNull(),
  fromLifecycle: text('from_lifecycle'),
  toLifecycle: text('to_lifecycle').notNull(),
  validTo: date('valid_to'),
  note: text('note'),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const overrides = declarationsSchema.table('overrides', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  companyId: uuid('company_id').notNull(),
  issues: text('issues').array().notNull(),
  reason: text('reason').notNull(),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const chases = declarationsSchema.table('chases', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  companyId: uuid('company_id').notNull(),
  claimId: uuid('claim_id'),
  kinds: text('kinds').array().notNull(),
  channel: text('channel').notNull().default('email'),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  sentBy: uuid('sent_by'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});
