import {
  boolean,
  date,
  integer,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { DayBasis, DelayCause, EotForm, EventStatus, ItemKind } from '../domain/eot';
import type { DepType } from '../domain/programme';

export const schedulingSchema = pgSchema('scheduling');

export const schedules = schedulingSchema.table('schedules', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  source: text('source').$type<'native' | 'msp' | 'p6'>().notNull().default('native'),
  dataDate: date('data_date'),
  baselineSetAt: timestamp('baseline_set_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const activities = schedulingSchema.table('activities', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  scheduleId: uuid('schedule_id').notNull(),
  position: integer('position').notNull(),
  wbs: text('wbs').notNull().default(''),
  name: text('name').notNull(),
  kind: text('kind').$type<'task' | 'milestone'>().notNull().default('task'),
  startDate: date('start_date').notNull(),
  finishDate: date('finish_date').notNull(),
  pctComplete: integer('pct_complete').notNull().default(0),
  assignee: text('assignee').notNull().default(''),
  externalId: text('external_id'),
  baselineStart: date('baseline_start'),
  baselineFinish: date('baseline_finish'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dependencies = schedulingSchema.table('dependencies', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  scheduleId: uuid('schedule_id').notNull(),
  predecessorId: uuid('predecessor_id').notNull(),
  successorId: uuid('successor_id').notNull(),
  type: text('type').$type<DepType>().notNull().default('FS'),
  lagDays: integer('lag_days').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const activityLinks = schedulingSchema.table('activity_links', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  scheduleId: uuid('schedule_id').notNull(),
  activityId: uuid('activity_id').notNull(),
  kind: text('kind').$type<'rfi' | 'submittal'>().notNull(),
  targetId: uuid('target_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

const dec = (name: string, precision: number, scale: number) =>
  numeric(name, { precision, scale, mode: 'number' });

export const eotSettings = schedulingSchema.table('eot_settings', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  form: text('form').$type<EotForm>().notNull().default('as4000'),
  noticeDays: integer('notice_days').notNull().default(14),
  claimDays: integer('claim_days').notNull().default(28),
  dayBasis: text('day_basis').$type<DayBasis>().notNull().default('calendar'),
  noticeClause: text('notice_clause'),
  claimClause: text('claim_clause'),
  confirmed: boolean('confirmed').notNull().default(false),
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  rainThresholdMm: dec('rain_threshold_mm', 6, 1).notNull().default(10),
  wetDayAllowance: integer('wet_day_allowance'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const delayEvents = schedulingSchema.table('delay_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  cause: text('cause').$type<DelayCause>().notNull(),
  status: text('status').$type<EventStatus>().notNull().default('draft'),
  startedOn: date('started_on', { mode: 'string' }).notNull(),
  endedOn: date('ended_on', { mode: 'string' }),
  awareOn: date('aware_on', { mode: 'string' }).notNull(),
  criticalPath: boolean('critical_path'),
  summary: text('summary'),
  affected: text('affected'),
  daysClaimed: integer('days_claimed').notNull().default(0),
  noticeDueOn: date('notice_due_on', { mode: 'string' }),
  claimDueOn: date('claim_due_on', { mode: 'string' }),
  noticeSentOn: date('notice_sent_on', { mode: 'string' }),
  noticeRefId: uuid('notice_ref_id'),
  noticeRefLabel: text('notice_ref_label'),
  claimSentOn: date('claim_sent_on', { mode: 'string' }),
  claimRefId: uuid('claim_ref_id'),
  claimRefLabel: text('claim_ref_label'),
  assessedOn: date('assessed_on', { mode: 'string' }),
  daysGranted: integer('days_granted'),
  assessmentNote: text('assessment_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const delayEventItems = schedulingSchema.table('delay_event_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  eventId: uuid('event_id').notNull(),
  kind: text('kind').$type<ItemKind>().notNull(),
  sourceKey: text('source_key'),
  onDate: date('on_date', { mode: 'string' }),
  label: text('label').notNull(),
  detail: text('detail'),
  hours: dec('hours', 7, 2),
  days: dec('days', 7, 2),
  rainMm: dec('rain_mm', 6, 1),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  addedBy: uuid('added_by'),
});

export const delayEventLog = schedulingSchema.table('delay_event_log', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  eventId: uuid('event_id').notNull(),
  kind: text('kind').notNull(),
  detail: text('detail'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  byUser: uuid('by_user'),
});
