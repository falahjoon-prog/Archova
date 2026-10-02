import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { MarkupVisibility } from '@archova/markup';
import type { StoredShape } from '../domain/markup';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const documents = pgSchema('documents');

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

export type DocumentStatus =
  'draft' | 'for_review' | 'approved' | 'for_construction' | 'superseded' | 'void';
export type IssuedFor = 'preliminary' | 'for_tender' | 'for_approval' | 'for_construction';
export type TransmittalPurpose =
  'for_information' | 'for_review' | 'for_construction' | 'for_tender' | 'other';

export const folders = documents.table('folders', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  isPrivate: boolean('is_private').notNull().default(false),
  allowedUserIds: uuid('allowed_user_ids').array().notNull().default([]),
  allowedCompanyIds: uuid('allowed_company_ids').array().notNull().default([]),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const documentsTable = documents.table('documents', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  folderId: uuid('folder_id').notNull(),
  title: text('title').notNull(),
  docNumber: text('doc_number'),
  discipline: text('discipline'),
  docType: text('doc_type'),
  currentRevisionId: uuid('current_revision_id'),
  status: text('status').$type<DocumentStatus>().notNull(),
  custom: jsonb('custom').notNull().default({}),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const documentRevisions = documents.table('document_revisions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  documentId: uuid('document_id').notNull(),
  rev: text('rev').notNull(),
  fileId: uuid('file_id').notNull(),
  status: text('status').$type<'current' | 'superseded'>().notNull(),
  issuedFor: text('issued_for'),
  issuedDate: date('issued_date'),
  notes: text('notes'),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  ...audit,
});

export const drawingSets = documents.table('drawing_sets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  issuedDate: date('issued_date'),
  receivedDate: date('received_date'),
  status: text('status').$type<'processing' | 'review' | 'published'>().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by'),
  ...audit,
});

export const drawingSheets = documents.table('drawing_sheets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  sheetNumber: text('sheet_number').notNull(),
  title: text('title').notNull(),
  discipline: text('discipline'),
  area: text('area'),
  currentRevisionId: uuid('current_revision_id'),
  ...audit,
});

export const drawingRevisions = documents.table('drawing_revisions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  setId: uuid('set_id').notNull(),
  sheetId: uuid('sheet_id'),
  sheetNumber: text('sheet_number').notNull(),
  title: text('title').notNull(),
  discipline: text('discipline'),
  rev: text('rev').notNull(),
  issuedFor: text('issued_for').$type<IssuedFor>(),
  fileId: uuid('file_id').notNull(),
  pageIndex: integer('page_index').notNull().default(0),
  status: text('status').$type<'draft' | 'current' | 'superseded'>().notNull(),
  drawingDate: date('drawing_date'),
  publishReason: text('publish_reason'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  supersededById: uuid('superseded_by_id'),
  ocrSheetNumber: text('ocr_sheet_number'),
  ocrTitle: text('ocr_title'),
  ocrConfidence: real('ocr_confidence'),
  ...audit,
});

export const drawingMarkups = documents.table('drawing_markups', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  ownerId: uuid('owner_id').notNull(),
  ownerCompanyId: uuid('owner_company_id'),
  visibility: text('visibility').$type<MarkupVisibility>().notNull(),
  shapes: jsonb('shapes').$type<StoredShape[]>().notNull(),
  copiedFromId: uuid('copied_from_id'),
  needsLocationCheck: boolean('needs_location_check').notNull().default(false),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const transmittals = documents.table('transmittals', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number'),
  subject: text('subject').notNull(),
  purpose: text('purpose').$type<TransmittalPurpose>().notNull(),
  fromCompanyId: uuid('from_company_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  sentBy: uuid('sent_by'),
  responseDue: date('response_due'),
  message: text('message'),
  status: text('status').$type<'draft' | 'sent'>().notNull(),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const transmittalItems = documents.table('transmittal_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  transmittalId: uuid('transmittal_id').notNull(),
  revisionType: text('revision_type').$type<'document' | 'drawing'>().notNull(),
  revisionId: uuid('revision_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const transmittalRecipients = documents.table('transmittal_recipients', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  transmittalId: uuid('transmittal_id').notNull(),
  userId: uuid('user_id'),
  companyId: uuid('company_id'),
  email: citext('email').notNull(),
  name: text('name'),
  role: text('role').$type<'to' | 'cc'>().notNull(),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  accessLinkId: uuid('access_link_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
