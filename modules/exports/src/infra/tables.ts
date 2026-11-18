import { bigint, char, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const exportsSchema = pgSchema('exports');

export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';

export const exportJobs = exportsSchema.table('export_jobs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  status: text('status').$type<ExportStatus>().notNull(),
  storageKey: text('storage_key'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  sha256: char('sha256', { length: 64 }),
  tableCount: integer('table_count'),
  fileCount: integer('file_count'),
  skippedFileCount: integer('skipped_file_count'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
});
