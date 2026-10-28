import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { RfiStatus } from '../domain/rfi';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const rfisSchema = pgSchema('rfis');

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

export type CostImpact = 'yes' | 'no' | 'tbc';

export const rfis = rfisSchema.table('rfis', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number'),
  subject: text('subject').notNull(),
  question: jsonb('question'),
  questionText: text('question_text').notNull(),
  status: text('status').$type<RfiStatus>().notNull(),
  isPrivate: boolean('is_private').notNull().default(false),
  managerId: uuid('manager_id'),
  raisedByCompanyId: uuid('raised_by_company_id'),
  receivedFromCompanyId: uuid('received_from_company_id'),
  distributionUserIds: uuid('distribution_user_ids').array().notNull().default([]),
  distributionCompanyIds: uuid('distribution_company_ids').array().notNull().default([]),
  dueDate: date('due_date'),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidReason: text('void_reason'),
  costImpact: text('cost_impact').$type<CostImpact>(),
  costEstimate: numeric('cost_estimate', { precision: 18, scale: 2 }),
  currency: text('currency').notNull().default('AUD'),
  scheduleImpactDays: integer('schedule_impact_days'),
  delayDays: integer('delay_days'),
  locationId: uuid('location_id'),
  drawingRevisionId: uuid('drawing_revision_id'),
  pinX: real('pin_x'),
  pinY: real('pin_y'),
  specSectionId: uuid('spec_section_id'),
  officialResponseId: uuid('official_response_id'),
  sourceRef: text('source_ref'),
  aiSuggestionId: uuid('ai_suggestion_id'),
  custom: jsonb('custom').notNull().default({}),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const assignees = rfisSchema.table('assignees', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  rfiId: uuid('rfi_id').notNull(),
  userId: uuid('user_id').notNull(),
  companyId: uuid('company_id'),
  isBallInCourt: boolean('is_ball_in_court').notNull().default(false),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const responses = rfisSchema.table('responses', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  rfiId: uuid('rfi_id').notNull(),
  authorId: uuid('author_id'),
  authorName: text('author_name'),
  authorEmail: citext('author_email'),
  body: jsonb('body'),
  bodyText: text('body_text').notNull(),
  fileIds: uuid('file_ids').array().notNull().default([]),
  isOfficial: boolean('is_official').notNull().default(false),
  aiSuggestionId: uuid('ai_suggestion_id'),
  ...audit,
});
