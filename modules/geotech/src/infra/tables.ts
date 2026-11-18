import {
  date,
  doublePrecision,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EarthworksKind, InvestigationKind, TestKind } from '../domain/geotech';

export const geotechSchema = pgSchema('geotech');
const num = (name: string, precision: number, scale: number) =>
  numeric(name, { precision, scale, mode: 'number' });

export const investigations = geotechSchema.table('investigations', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  kind: text('kind').$type<InvestigationKind>().notNull(),
  title: text('title').notNull(),
  location: text('location'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  depthM: num('depth_m', 8, 2),
  groundwaterDepthM: num('groundwater_depth_m', 8, 2),
  investigatedOn: date('investigated_on'),
  consultantCompanyId: uuid('consultant_company_id'),
  summary: text('summary'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const testResults = geotechSchema.table('test_results', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  investigationId: uuid('investigation_id'),
  kind: text('kind').$type<TestKind>().notNull(),
  sampleRef: text('sample_ref'),
  zone: text('zone'),
  depthFromM: num('depth_from_m', 8, 2),
  depthToM: num('depth_to_m', 8, 2),
  value: num('value', 12, 3).notNull(),
  unit: text('unit').notNull().default(''),
  specMin: num('spec_min', 12, 3),
  specMax: num('spec_max', 12, 3),
  testedOn: date('tested_on').notNull(),
  lab: text('lab'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const earthworksEntries = geotechSchema.table('earthworks_entries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  zone: text('zone').notNull(),
  kind: text('kind').$type<EarthworksKind>().notNull(),
  volumeM3: num('volume_m3', 12, 3).notNull(),
  material: text('material'),
  recordedOn: date('recorded_on').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
