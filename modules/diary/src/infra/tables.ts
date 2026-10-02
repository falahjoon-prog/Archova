import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { DelayType, DiaryStatus, LineKind } from '../domain/diary';

export const diarySchema = pgSchema('diary');

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

/** Common columns of every child line. */
const line = () => ({
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  entryId: uuid('entry_id').notNull(),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

const hours = (name: string) => numeric(name, { precision: 6, scale: 2, mode: 'number' });

export interface Weather {
  minTempC?: number | null;
  maxTempC?: number | null;
  rainfallMm?: number | null;
  windKmh?: number | null;
  windDirection?: string | null;
  conditions?: { am?: string | null; midday?: string | null; pm?: string | null } | null;
}

export const entries = diarySchema.table('entries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  date: date('date').notNull(),
  status: text('status').$type<DiaryStatus>().notNull().default('draft'),
  weatherStationId: text('weather_station_id'),
  weather: jsonb('weather').$type<Weather>(),
  weatherOverride: jsonb('weather_override').$type<Weather>(),
  weatherNotes: text('weather_notes'),
  siteConditions: text('site_conditions'),
  notes: jsonb('notes'),
  notesText: text('notes_text').notNull().default(''),
  fileIds: uuid('file_ids').array().notNull().default([]),
  submittedBy: uuid('submitted_by'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submitReceivedAt: timestamp('submit_received_at', { withTimezone: true }),
  isLate: boolean('is_late').notNull().default(false),
  signedOffBy: uuid('signed_off_by'),
  signedOffAt: timestamp('signed_off_at', { withTimezone: true }),
  ...audit,
});

export type AmendmentTarget = 'entry' | LineKind;

export const amendments = diarySchema.table('amendments', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  entryId: uuid('entry_id').notNull(),
  targetType: text('target_type').$type<AmendmentTarget>().notNull(),
  targetId: uuid('target_id').notNull(),
  action: text('action').$type<'create' | 'update' | 'delete'>().notNull(),
  changes: jsonb('changes').$type<Record<string, [unknown, unknown]>>().notNull(),
  reason: text('reason').notNull(),
  amendedBy: uuid('amended_by'),
  amendedAt: timestamp('amended_at', { withTimezone: true }).notNull().defaultNow(),
});

export const labour = diarySchema.table('labour', {
  ...line(),
  companyId: uuid('company_id').notNull(),
  trade: text('trade'),
  headcount: integer('headcount'),
  hours: hours('hours'),
  source: text('source').$type<'manual' | 'attendance'>().notNull().default('manual'),
  attendanceHeadcount: integer('attendance_headcount'),
  attendanceHours: hours('attendance_hours'),
  editReason: text('edit_reason'),
  costCodeId: uuid('cost_code_id'),
  locationId: uuid('location_id'),
  notes: text('notes'),
});

export const plant = diarySchema.table('plant', {
  ...line(),
  companyId: uuid('company_id'),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull().default(1),
  hours: hours('hours'),
  status: text('status').$type<'working' | 'idle' | 'broken_down'>().notNull().default('working'),
});

export const deliveries = diarySchema.table('deliveries', {
  ...line(),
  supplierCompanyId: uuid('supplier_company_id'),
  supplierName: text('supplier_name'),
  description: text('description').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  docketNumber: text('docket_number'),
});

export const delays = diarySchema.table('delays', {
  ...line(),
  type: text('type').$type<DelayType>().notNull(),
  description: text('description').notNull(),
  hours: hours('hours').notNull(),
  affectedCompanyIds: uuid('affected_company_ids').array().notNull().default([]),
  isEotCandidate: boolean('is_eot_candidate').notNull(),
});

export const visitors = diarySchema.table('visitors', {
  ...line(),
  name: text('name').notNull(),
  company: text('company'),
  purpose: text('purpose'),
  timeIn: time('time_in'),
  timeOut: time('time_out'),
});

export const events = diarySchema.table('events', {
  ...line(),
  kind: text('kind').notNull(),
  at: time('at'),
  description: text('description').notNull(),
  related: jsonb('related').notNull().default({}),
});

export const standDowns = diarySchema.table('stand_downs', {
  ...line(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time'),
  affectedCompanyIds: uuid('affected_company_ids').array().notNull().default([]),
  reason: text('reason'),
});

export const LINE_TABLES = {
  labour,
  plant,
  delivery: deliveries,
  delay: delays,
  visitor: visitors,
  event: events,
  stand_down: standDowns,
} as const;
