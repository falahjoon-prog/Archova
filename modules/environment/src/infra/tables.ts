import {
  boolean,
  date,
  integer,
  numeric,
  pgSchema,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  ConditionCategory,
  ConditionFrequency,
  ConditionSource,
  ConditionStatus,
} from '../domain/condition';
import type { DocumentType } from '../domain/document';
import type { CarbonScope, CarbonSource } from '../domain/carbon';
import type { WasteDestination, WasteType } from '../domain/waste';
import type { MonitoringFrequency, Parameter, ReadingStatus } from '../domain/monitoring';

export const environmentSchema = pgSchema('environment');

export const plans = environmentSchema.table('plans', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  title: text('title').notNull(),
  permitReference: text('permit_reference'),
  summary: text('summary'),
  status: text('status').$type<'draft' | 'active'>().notNull().default('draft'),
  reviewIntervalMonths: integer('review_interval_months').notNull().default(6),
  nextReviewDate: date('next_review_date'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const conditions = environmentSchema.table('conditions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  requirement: text('requirement'),
  category: text('category').$type<ConditionCategory>().notNull(),
  source: text('source').$type<ConditionSource>().notNull().default('other'),
  sourceReference: text('source_reference'),
  frequency: text('frequency').$type<ConditionFrequency>().notNull().default('once'),
  responsibleCompanyId: uuid('responsible_company_id'),
  responsibleUserId: uuid('responsible_user_id'),
  status: text('status').$type<ConditionStatus>().notNull().default('not_started'),
  dueDate: date('due_date'),
  lastReviewedOn: date('last_reviewed_on'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const conditionEvents = environmentSchema.table('condition_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  conditionId: uuid('condition_id').notNull(),
  action: text('action').notNull(),
  fromStatus: text('from_status').$type<ConditionStatus>().notNull(),
  toStatus: text('to_status').$type<ConditionStatus>().notNull(),
  note: text('note'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const documents = environmentSchema.table('documents', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  title: text('title').notNull(),
  docType: text('doc_type').$type<DocumentType>().notNull(),
  reference: text('reference'),
  fileId: uuid('file_id').notNull(),
  issuedOn: date('issued_on'),
  expiresOn: date('expires_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const monitoringPoints = environmentSchema.table('monitoring_points', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  parameter: text('parameter').$type<Parameter>().notNull(),
  unit: text('unit').notNull(),
  location: text('location'),
  minLimit: numeric('min_limit'),
  maxLimit: numeric('max_limit'),
  warnMargin: numeric('warn_margin').notNull().default('0.2'),
  frequency: text('frequency').$type<MonitoringFrequency>().notNull().default('daily'),
  conditionId: uuid('condition_id'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const readings = environmentSchema.table('readings', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  pointId: uuid('point_id').notNull(),
  value: numeric('value').notNull(),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull(),
  status: text('status').$type<ReadingStatus>().notNull(),
  note: text('note'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  responseNote: text('response_note'),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  respondedBy: uuid('responded_by'),
  incidentId: uuid('incident_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const wasteDockets = environmentSchema.table('waste_dockets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  docketDate: date('docket_date').notNull(),
  wasteType: text('waste_type').$type<WasteType>().notNull(),
  destination: text('destination').$type<WasteDestination>().notNull(),
  tonnes: numeric('tonnes').notNull(),
  docketNumber: text('docket_number'),
  contractor: text('contractor'),
  facility: text('facility'),
  note: text('note'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const carbonEntries = environmentSchema.table('carbon_entries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  entryDate: date('entry_date').notNull(),
  source: text('source').$type<CarbonSource>().notNull(),
  scope: smallint('scope').$type<CarbonScope>().notNull(),
  quantity: numeric('quantity').notNull(),
  factor: numeric('factor').notNull(),
  kgCo2e: numeric('kg_co2e').notNull(),
  description: text('description'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
