import { boolean, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { DeliveryStatus, EventKind, ResourceKind } from '../domain/logistics';

export const logisticsSchema = pgSchema('logistics');

export interface DeliveryItem {
  description: string;
  quantity?: string | null | undefined;
  unit?: string | null | undefined;
}

export const resources = logisticsSchema.table('resources', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').$type<ResourceKind>().notNull(),
  capacity: integer('capacity').notNull().default(1),
  active: boolean('active').notNull().default(true),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const deliveries = logisticsSchema.table('deliveries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  supplierName: text('supplier_name').notNull(),
  supplierCompanyId: uuid('supplier_company_id'),
  supplierContact: text('supplier_contact'),
  supplierEmail: text('supplier_email'),
  supplierPhone: text('supplier_phone'),
  items: jsonb('items').$type<DeliveryItem[]>().notNull().default([]),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  zoneId: uuid('zone_id'),
  needsLift: boolean('needs_lift').notNull().default(false),
  liftResourceId: uuid('lift_resource_id'),
  liftStart: timestamp('lift_start', { withTimezone: true }),
  liftEnd: timestamp('lift_end', { withTimezone: true }),
  vehicle: text('vehicle'),
  accessNotes: text('access_notes'),
  status: text('status').$type<DeliveryStatus>().notNull().default('scheduled'),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  unloadedAt: timestamp('unloaded_at', { withTimezone: true }),
  statusReason: text('status_reason'),
  commitmentId: uuid('commitment_id'),
  commitmentLabel: text('commitment_label'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const deliveryEvents = logisticsSchema.table('delivery_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  deliveryId: uuid('delivery_id').notNull(),
  kind: text('kind').$type<EventKind>().notNull(),
  detail: text('detail'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  byUser: uuid('by_user'),
});
