import {
  boolean,
  customType,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgSchema,
  real,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EligibilityReason, EligibilityResult, GateCheckMode } from '../domain/attendance';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const workforceSchema = pgSchema('workforce');

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

export const sites = workforceSchema.table('sites', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  boundaryMode: text('boundary_mode').$type<'project' | 'custom'>().notNull().default('project'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  radiusM: integer('radius_m'),
  dayEndLocal: time('day_end_local').notNull().default('19:00'),
  geofenceEnabled: boolean('geofence_enabled').notNull().default(false),
  gateCheckMode: text('gate_check_mode').$type<GateCheckMode>().notNull().default('block'),
  active: boolean('active').notNull().default(true),
  ...audit,
});

export const gates = workforceSchema.table('gates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  siteId: uuid('site_id').notNull(),
  name: text('name').notNull(),
  qrTokenHash: text('qr_token_hash').notNull(),
  qrVersion: integer('qr_version').notNull().default(1),
  active: boolean('active').notNull().default(true),
  ...audit,
});

export const workers = workforceSchema.table('workers', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id'),
  companyId: uuid('company_id'),
  companyNameOther: text('company_name_other'),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  email: citext('email'),
  kind: text('kind').$type<'worker' | 'visitor' | 'delivery'>().notNull().default('worker'),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  ...audit,
});

export const eligibilityChecks = workforceSchema.table('eligibility_checks', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  siteId: uuid('site_id').notNull(),
  workerId: uuid('worker_id').notNull(),
  localDate: date('local_date').notNull(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  result: text('result').$type<EligibilityResult>().notNull(),
  answeredBy: text('answered_by').$type<'workforce' | 'wallet'>().notNull().default('workforce'),
  reasons: jsonb('reasons').$type<EligibilityReason[]>().notNull(),
  sources: jsonb('sources').$type<unknown[]>().notNull(),
});

export type AttendanceKind = 'sign_in' | 'sign_out' | 'auto_sign_out';
export type AttendanceMethod = 'qr' | 'geofence' | 'kiosk' | 'manual' | 'auto';

export const attendanceEvents = workforceSchema.table('attendance_events', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  siteId: uuid('site_id').notNull(),
  gateId: uuid('gate_id'),
  workerId: uuid('worker_id').notNull(),
  sessionId: uuid('session_id'),
  kind: text('kind').$type<AttendanceKind>().notNull(),
  method: text('method').$type<AttendanceMethod>().notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  localDate: date('local_date').notNull(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  accuracyM: real('accuracy_m'),
  fixSource: text('fix_source').$type<'device' | 'manual'>(),
  geofenceStatus: text('geofence_status').$type<'inside' | 'outside' | 'uncertain'>(),
  deviceId: text('device_id'),
  recordedBy: uuid('recorded_by'),
  eligibilityCheckId: uuid('eligibility_check_id'),
  outcome: text('outcome')
    .$type<'accepted' | 'blocked' | 'overridden'>()
    .notNull()
    .default('accepted'),
  overrideReason: text('override_reason'),
  overrideBy: uuid('override_by'),
  offline: boolean('offline').notNull().default(false),
});

export type SessionStatus = 'on_site' | 'off_site' | 'auto_closed' | 'disputed';

export const attendanceSessions = workforceSchema.table('attendance_sessions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  siteId: uuid('site_id').notNull(),
  workerId: uuid('worker_id').notNull(),
  companyId: uuid('company_id'),
  localDate: date('local_date').notNull(),
  signedInAt: timestamp('signed_in_at', { withTimezone: true }).notNull(),
  signedOutAt: timestamp('signed_out_at', { withTimezone: true }),
  minutes: integer('minutes'),
  status: text('status').$type<SessionStatus>().notNull().default('on_site'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export interface RollCallEntry {
  workerId: string;
  fullName: string;
  phone: string | null;
  companyId: string | null;
  companyNameOther: string | null;
  siteId: string;
  signedInAt: string;
}

export const rollCalls = workforceSchema.table('roll_calls', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  siteId: uuid('site_id'),
  startedBy: uuid('started_by'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  endedBy: uuid('ended_by'),
  reason: text('reason').notNull(),
  snapshot: jsonb('snapshot').$type<RollCallEntry[]>().notNull(),
});

export type MarkStatus = 'accounted_for' | 'missing' | 'not_on_site';

export const rollCallMarks = workforceSchema.table('roll_call_marks', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  rollCallId: uuid('roll_call_id').notNull(),
  workerId: uuid('worker_id').notNull(),
  status: text('status').$type<MarkStatus>().notNull(),
  markedBy: uuid('marked_by'),
  markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
});
