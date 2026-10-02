import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { GeoFixSource } from '@archova/domain';

export const files = pgSchema('files');

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

/** When and where the file was captured (X32). Same columns on upload sessions and file objects. */
const captureColumns = () => ({
  takenAt: timestamp('taken_at', { withTimezone: true }),
  takenTz: text('taken_tz'),
  captureLat: doublePrecision('capture_lat'),
  captureLng: doublePrecision('capture_lng'),
  captureAccuracyM: real('capture_accuracy_m'),
  captureHeadingDeg: real('capture_heading_deg'),
  captureSource: text('capture_source').$type<GeoFixSource>(),
});

export const uploadSessions = files.table('upload_sessions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id'),
  module: text('module').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  multipartUploadId: text('multipart_upload_id'),
  quarantineKey: text('quarantine_key').notNull(),
  status: text('status').$type<'pending' | 'uploaded' | 'expired'>().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  fileId: uuid('file_id'),
  ...captureColumns(),
  ...audit,
});

export const fileObjects = files.table('file_objects', {
  id: uuid('id').notNull(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id'),
  module: text('module').notNull(),
  storageKey: text('storage_key').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  status: text('status').$type<'scanning' | 'ready' | 'infected' | 'failed'>().notNull(),
  width: integer('width'),
  height: integer('height'),
  pageCount: integer('page_count'),
  ...captureColumns(),
  renditions: jsonb('renditions').$type<Record<string, string>>().notNull().default({}),
  legalHold: boolean('legal_hold').notNull().default(false),
  dedupeOf: uuid('dedupe_of'),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
