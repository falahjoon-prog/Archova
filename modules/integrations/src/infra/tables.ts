import { customType, integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ImportEntity } from '@archova/ai-prompts';
import type { WebhookPayload } from '../domain/webhooks/events';
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

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const webhookSubscriptions = integrationsSchema.table('webhook_subscriptions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  url: text('url').notNull(),
  description: text('description'),
  eventTypes: text('event_types').array().notNull(),
  projectIds: uuid('project_ids').array(),
  secretSealed: bytea('secret_sealed').notNull(),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  disabledReason: text('disabled_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = integrationsSchema.table('webhook_deliveries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  subscriptionId: uuid('subscription_id').notNull(),
  eventId: uuid('event_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<WebhookPayload>().notNull(),
  status: text('status')
    .$type<'pending' | 'succeeded' | 'abandoned'>()
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull(),
  lastStatus: integer('last_status'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
});
