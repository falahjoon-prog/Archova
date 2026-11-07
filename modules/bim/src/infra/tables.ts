import { date, integer, pgSchema, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const bimSchema = pgSchema('bim');

export type Discipline =
  | 'architectural'
  | 'structural'
  | 'mechanical'
  | 'electrical'
  | 'hydraulic'
  | 'fire'
  | 'civil'
  | 'other';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

export const models = bimSchema.table('models', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  discipline: text('discipline').$type<Discipline>().notNull(),
  versionLabel: text('version_label').notNull().default(''),
  fileId: uuid('file_id'),
  status: text('status').$type<'current' | 'superseded'>().notNull().default('current'),
  supersededById: uuid('superseded_by_id'),
  ...audit,
});

export const issues = bimSchema.table('issues', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status').$type<IssueStatus>().notNull().default('open'),
  priority: text('priority').$type<IssuePriority>().notNull().default('medium'),
  assigneeId: uuid('assignee_id'),
  dueDate: date('due_date'),
  modelId: uuid('model_id'),
  elementGuids: text('element_guids').array().notNull().default([]),
  location: text('location').notNull().default(''),
  rfiId: uuid('rfi_id'),
  drawingRevisionId: uuid('drawing_revision_id'),
  sheetId: uuid('sheet_id'),
  pinX: real('pin_x'),
  pinY: real('pin_y'),
  snapshotFileId: uuid('snapshot_file_id'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const issueComments = bimSchema.table('issue_comments', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  issueId: uuid('issue_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
