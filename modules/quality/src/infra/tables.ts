import {
  boolean,
  date,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ItemResult, InspectionStatus, ResponseType } from '../domain/inspection';
import type { ItemEventKind } from '../domain/item-activity';
import type { ObservationStatus, ObservationType } from '../domain/observation';

export const qualitySchema = pgSchema('quality');

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export const templates = qualitySchema.table('inspection_templates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull().default('ITP'),
  version: integer('version').notNull().default(1),
  published: boolean('published').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const templateItems = qualitySchema.table('inspection_template_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  templateId: uuid('template_id').notNull(),
  section: text('section').notNull().default(''),
  sort: integer('sort').notNull(),
  prompt: text('prompt').notNull(),
  responseType: text('response_type').$type<ResponseType>().notNull(),
  options: jsonb('options').$type<string[]>().notNull().default([]),
  required: boolean('required').notNull().default(true),
  createsDefectOnFail: boolean('creates_defect_on_fail').notNull().default(false),
  helpText: text('help_text').notNull().default(''),
});

export interface SignedBy {
  name: string;
  fileId: string | null;
  at: string;
}

export const inspections = qualitySchema.table('inspections', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  templateId: uuid('template_id').notNull(),
  templateVersion: integer('template_version').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  location: text('location'),
  locationId: uuid('location_id'),
  status: text('status').$type<InspectionStatus>().notNull().default('scheduled'),
  inspectorId: uuid('inspector_id'),
  scheduledFor: date('scheduled_for'),
  dueDate: date('due_date'),
  assigneeIds: uuid('assignee_ids').array().notNull().default([]),
  responsibleCompanyId: uuid('responsible_company_id'),
  pointOfContactId: uuid('point_of_contact_id'),
  naSections: text('na_sections').array().notNull().default([]),
  trade: text('trade'),
  specSection: text('spec_section'),
  description: text('description').notNull().default(''),
  fileIds: uuid('file_ids').array().notNull().default([]),
  isPrivate: boolean('is_private').notNull().default(false),
  distributionIds: uuid('distribution_ids').array().notNull().default([]),
  drawingRevisionIds: uuid('drawing_revision_ids').array().notNull().default([]),
  reopenCount: integer('reopen_count').notNull().default(0),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  signedBy: jsonb('signed_by').$type<SignedBy | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const responses = qualitySchema.table(
  'inspection_responses',
  {
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id').notNull(),
    inspectionId: uuid('inspection_id').notNull(),
    templateItemId: uuid('template_item_id').notNull(),
    value: jsonb('value'),
    result: text('result').$type<ItemResult>(),
    note: text('note'),
    fileIds: uuid('file_ids').array().notNull().default([]),
    defectId: uuid('defect_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [unique().on(t.inspectionId, t.templateItemId)],
);

export const observations = qualitySchema.table('observations', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  type: text('type').$type<ObservationType>().notNull(),
  typeKey: text('type_key'),
  hazard: text('hazard'),
  description: text('description').notNull(),
  location: text('location'),
  locationId: uuid('location_id'),
  priority: text('priority').$type<Priority>().notNull().default('medium'),
  assigneeCompanyId: uuid('assignee_company_id'),
  raisedByCompanyId: uuid('raised_by_company_id'),
  status: text('status').$type<ObservationStatus>().notNull().default('open'),
  dueDate: date('due_date'),
  swmsId: uuid('swms_id'),
  inspectionId: uuid('inspection_id'),
  inspectionItemId: uuid('inspection_item_id'),
  resolutionNote: text('resolution_note'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: uuid('closed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const itemEvents = qualitySchema.table('inspection_item_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  inspectionId: uuid('inspection_id').notNull(),
  templateItemId: uuid('template_item_id').notNull(),
  kind: text('kind').$type<ItemEventKind>().notNull(),
  body: text('body'),
  result: text('result').$type<ItemResult>(),
  fileIds: uuid('file_ids').array().notNull().default([]),
  observationId: uuid('observation_id'),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const signatures = qualitySchema.table('inspection_signatures', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  inspectionId: uuid('inspection_id').notNull(),
  name: text('name').notNull(),
  fileId: uuid('file_id'),
  signedBy: uuid('signed_by'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const observationTypes = qualitySchema.table('observation_types', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id'),
  key: text('key'),
  group: text('group_name'),
  name: text('name'),
  category: text('category').$type<ObservationType>(),
  requiresAttachment: boolean('requires_attachment'),
  hidden: boolean('hidden').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type HistoryKind =
  'created' | 'updated' | 'section_na' | 'signed' | 'submitted' | 'reopened' | 'closed' | 'deleted';

export const history = qualitySchema.table('inspection_history', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  inspectionId: uuid('inspection_id').notNull(),
  kind: text('kind').$type<HistoryKind>().notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  actorId: uuid('actor_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});
