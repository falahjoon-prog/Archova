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
import type {
  ActionItemStatus,
  ActionPlanSourceType,
  ActionPlanStatus,
  TemplateItem,
} from '../domain/action-plan';
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
  status: text('status').$type<InspectionStatus>().notNull().default('scheduled'),
  inspectorId: uuid('inspector_id'),
  scheduledFor: date('scheduled_for'),
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
  hazard: text('hazard'),
  description: text('description').notNull(),
  location: text('location'),
  priority: text('priority').$type<Priority>().notNull().default('medium'),
  assigneeCompanyId: uuid('assignee_company_id'),
  raisedByCompanyId: uuid('raised_by_company_id'),
  status: text('status').$type<ObservationStatus>().notNull().default('open'),
  dueDate: date('due_date'),
  swmsId: uuid('swms_id'),
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

export const actionPlanTemplates = qualitySchema.table('action_plan_templates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  items: jsonb('items').$type<TemplateItem[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const actionPlans = qualitySchema.table('action_plans', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').$type<ActionPlanStatus>().notNull().default('active'),
  dueDate: date('due_date'),
  templateId: uuid('template_id'),
  sourceType: text('source_type').$type<ActionPlanSourceType>(),
  sourceId: uuid('source_id'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const actionPlanItems = qualitySchema.table('action_plan_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  planId: uuid('plan_id').notNull(),
  sort: integer('sort').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  assigneeCompanyId: uuid('assignee_company_id'),
  dueDate: date('due_date'),
  status: text('status').$type<ActionItemStatus>().notNull().default('open'),
  note: text('note'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  completedBy: uuid('completed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});
