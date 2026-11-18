import { boolean, date, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { CheckResult, CheckStage, UnitKind, UnitStatus } from '../domain/prefab';

export const prefabSchema = pgSchema('prefab');

export const units = prefabSchema.table('units', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<UnitKind>().notNull(),
  factoryName: text('factory_name'),
  supplierCompanyId: uuid('supplier_company_id'),
  location: text('location'),
  installSequence: integer('install_sequence'),
  weightKg: integer('weight_kg'),
  dimensions: text('dimensions'),
  status: text('status').$type<UnitStatus>().notNull().default('planned'),
  progressPct: integer('progress_pct').notNull().default(0),
  fabStart: date('fab_start', { mode: 'string' }),
  fabDue: date('fab_due', { mode: 'string' }),
  shipDate: date('ship_date', { mode: 'string' }),
  installDate: date('install_date', { mode: 'string' }),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  installedAt: timestamp('installed_at', { withTimezone: true }),
  statusReason: text('status_reason'),
  deliveryId: uuid('delivery_id'),
  deliveryLabel: text('delivery_label'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const qaChecks = prefabSchema.table('qa_checks', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  stage: text('stage').$type<CheckStage>().notNull(),
  label: text('label').notNull(),
  required: boolean('required').notNull().default(true),
  result: text('result').$type<CheckResult>().notNull().default('pending'),
  note: text('note'),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  checkedBy: uuid('checked_by'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const unitEvents = prefabSchema.table('unit_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  kind: text('kind').notNull(),
  detail: text('detail'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  byUser: uuid('by_user'),
});
