import {
  bigint,
  boolean,
  date,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AssetCategory,
  AssetStatus,
  ConditionKind,
  Ownership,
  PlanKind,
} from '../domain/plant';

export const plantSchema = pgSchema('plant');

export const assets = plantSchema.table('assets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  assetNumber: text('asset_number').notNull(),
  category: text('category').$type<AssetCategory>().notNull(),
  ownership: text('ownership').$type<Ownership>().notNull(),
  supplier: text('supplier'),
  make: text('make'),
  model: text('model'),
  serialNumber: text('serial_number'),
  dailyRateCents: bigint('daily_rate_cents', { mode: 'number' }),
  status: text('status').$type<AssetStatus>().notNull().default('active'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const allocations = plantSchema.table('allocations', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => assets.id),
  projectId: uuid('project_id').notNull(),
  costCodeId: uuid('cost_code_id'),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on').notNull(),
  note: text('note'),
  status: text('status').$type<'active' | 'cancelled'>().notNull().default('active'),
  postedThrough: date('posted_through'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const costPostings = plantSchema.table('cost_postings', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  allocationId: uuid('allocation_id')
    .notNull()
    .references(() => allocations.id),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => assets.id),
  projectId: uuid('project_id').notNull(),
  fromOn: date('from_on').notNull(),
  toOn: date('to_on').notNull(),
  days: integer('days').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  directCostId: uuid('direct_cost_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const maintenancePlans = plantSchema.table('maintenance_plans', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => assets.id),
  title: text('title').notNull(),
  kind: text('kind').$type<PlanKind>().notNull(),
  intervalDays: integer('interval_days'),
  nextDueOn: date('next_due_on'),
  lastDoneOn: date('last_done_on'),
  responsible: text('responsible'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const maintenanceRecords = plantSchema.table('maintenance_records', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  planId: uuid('plan_id')
    .notNull()
    .references(() => maintenancePlans.id),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => assets.id),
  doneOn: date('done_on').notNull(),
  performedBy: text('performed_by'),
  note: text('note'),
  costCents: bigint('cost_cents', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const conditionChecks = plantSchema.table('condition_checks', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  assetId: uuid('asset_id')
    .notNull()
    .references(() => assets.id),
  kind: text('kind').$type<ConditionKind>().notNull(),
  allocationId: uuid('allocation_id').references(() => allocations.id),
  recordId: uuid('record_id').references(() => maintenanceRecords.id),
  takenOn: date('taken_on').notNull(),
  note: text('note'),
  fileIds: uuid('file_ids').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});
