import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
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

export const PHOTO_CATEGORIES = [
  'safety_risk',
  'daily_log',
  'punch_list',
  'drawings',
  'inspections',
  'rfis',
  'unclassified',
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
export type PhotoRefKind =
  'rfi' | 'defect' | 'observation' | 'inspection' | 'diary_entry' | 'drawing_revision';
export type PhotoFilingSource = 'attach' | 'annotation' | 'manual' | 'nova';

export const photoFilings = files.table(
  'photo_filings',
  {
    orgId: uuid('org_id').notNull(),
    fileId: uuid('file_id').notNull(),
    projectId: uuid('project_id').notNull(),
    category: text('category').$type<PhotoCategory>().notNull(),
    refKind: text('ref_kind').$type<PhotoRefKind>(),
    refId: uuid('ref_id'),
    source: text('source').$type<PhotoFilingSource>().notNull(),
    filedBy: uuid('filed_by'),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.fileId] })],
);

export const photoAlbums = files.table('photo_albums', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const photoAlbumItems = files.table(
  'photo_album_items',
  {
    orgId: uuid('org_id').notNull(),
    albumId: uuid('album_id').notNull(),
    fileId: uuid('file_id').notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    addedBy: uuid('added_by'),
  },
  (t) => [primaryKey({ columns: [t.albumId, t.fileId] })],
);
