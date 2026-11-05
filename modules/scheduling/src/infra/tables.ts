import { date, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { DepType } from '../domain/programme';

export const schedulingSchema = pgSchema('scheduling');

export const schedules = schedulingSchema.table('schedules', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  source: text('source').$type<'native' | 'msp' | 'p6'>().notNull().default('native'),
  dataDate: date('data_date'),
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
