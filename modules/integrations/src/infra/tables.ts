import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ImportEntity } from '@archova/ai-prompts';
import type { Cell, Mapping, RowProblem } from '../domain/normalise';

export const integrationsSchema = pgSchema('integrations');

export type ImportSource = 'spreadsheet' | 'aconex_export' | 'procore_export';
export type ImportJobStatus =
  | 'uploaded'
  | 'parsed'
  | 'mapped'
  | 'validated'
  | 'applying'
  | 'done'
  | 'failed'
  | 'rolled_back'
  | 'cancelled';
export type ImportRowStatus = 'staged' | 'valid' | 'invalid' | 'skipped' | 'applied' | 'failed';

export const importJobs = integrationsSchema.table('import_jobs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  entity: text('entity').$type<ImportEntity>().notNull(),
  source: text('source').$type<ImportSource>().notNull().default('spreadsheet'),
  fileId: uuid('file_id').notNull(),
  status: text('status').$type<ImportJobStatus>().notNull().default('uploaded'),
  headerRow: integer('header_row').notNull().default(1),
  headers: jsonb('headers').$type<string[]>().notNull().default([]),
  mapping: jsonb('mapping').$type<Mapping>().notNull(),
  totalRows: integer('total_rows').notNull().default(0),
  validRows: integer('valid_rows').notNull().default(0),
  invalidRows: integer('invalid_rows').notNull().default(0),
  startedBy: uuid('started_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
});

export const importRows = integrationsSchema.table('import_rows', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  jobId: uuid('job_id').notNull(),
  rowNumber: integer('row_number').notNull(),
  raw: jsonb('raw').$type<string[]>().notNull(),
  normalised: jsonb('normalised').$type<Record<string, Cell> | null>(),
  sourceRef: text('source_ref'),
  status: text('status').$type<ImportRowStatus>().notNull().default('staged'),
  errors: jsonb('errors').$type<RowProblem[]>().notNull().default([]),
  createdEntityId: uuid('created_entity_id'),
});
