import {
  bigint,
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
import type { InductionContent } from '../domain/induction';

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

export interface SectionApproval {
  by: string;
  at: string;
  /** Hash of the section when it was approved; an edit makes the approval stale. */
  hash: string;
}

export const inductions = workforceSchema.table('inductions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  siteId: uuid('site_id'),
  title: text('title').notNull(),
  status: text('status').$type<'draft' | 'published' | 'archived'>().notNull().default('draft'),
  validityMonths: integer('validity_months').notNull().default(12),
  draft: jsonb('draft').$type<InductionContent>().notNull(),
  draftAiSuggestionId: uuid('draft_ai_suggestion_id'),
  draftApprovals: jsonb('draft_approvals')
    .$type<Record<string, SectionApproval>>()
    .notNull()
    .default({}),
  currentVersionId: uuid('current_version_id'),
  ...audit,
});

export const inductionVersions = workforceSchema.table('induction_versions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  inductionId: uuid('induction_id').notNull(),
  number: integer('number').notNull(),
  content: jsonb('content').$type<InductionContent>().notNull(),
  declarationText: text('declaration_text').notNull(),
  contentHash: text('content_hash').notNull(),
  redo: text('redo').$type<'all' | 'none'>().notNull(),
  graceDays: integer('grace_days').notNull().default(0),
  requiredFrom: timestamp('required_from', { withTimezone: true }).notNull(),
  changeNote: text('change_note'),
  aiSuggestionId: uuid('ai_suggestion_id'),
  approvedBy: uuid('approved_by').array().notNull().default([]),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  publishedBy: uuid('published_by'),
});

export interface SectionProgress {
  at: string;
  seconds: number;
}

export const inductionCompletions = workforceSchema.table('induction_completions', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  inductionId: uuid('induction_id').notNull(),
  versionId: uuid('version_id').notNull(),
  workerId: uuid('worker_id').notNull(),
  status: text('status').$type<'in_progress' | 'completed'>().notNull().default('in_progress'),
  method: text('method').$type<'self' | 'assisted' | 'link'>().notNull(),
  assistedBy: uuid('assisted_by'),
  /** Set for `method = link` (X45): the access link and the number or address the worker verified. */
  accessLinkId: uuid('access_link_id'),
  verifiedChannel: text('verified_channel').$type<'sms' | 'email'>(),
  verifiedTo: text('verified_to'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  progress: jsonb('progress').$type<Record<string, SectionProgress>>().notNull().default({}),
  quizPassedAt: timestamp('quiz_passed_at', { withTimezone: true }),
  quizScore: integer('quiz_score'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresOn: date('expires_on'),
  typedName: text('typed_name'),
  signatureFormat: text('signature_format').$type<'svg'>(),
  signatureData: text('signature_data'),
  declarationText: text('declaration_text'),
  fitForWork: boolean('fit_for_work'),
  deviceAt: timestamp('device_at', { withTimezone: true }),
  ip: text('ip'),
  userAgent: text('user_agent'),
  language: text('language').notNull().default('en'),
  translationHash: text('translation_hash'),
  evidenceHash: text('evidence_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const inductionQuizAttempts = workforceSchema.table('induction_quiz_attempts', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  completionId: uuid('completion_id').notNull(),
  attempt: integer('attempt').notNull(),
  questions: jsonb('questions').$type<string[]>().notNull(),
  answers: jsonb('answers').$type<Record<string, number>>().notNull(),
  score: integer('score').notNull(),
  criticalOk: boolean('critical_ok').notNull(),
  passed: boolean('passed').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CredentialKind = 'white_card' | 'high_risk_licence' | 'trade_licence' | 'other';

export const workerCredentials = workforceSchema.table('worker_credentials', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  workerId: uuid('worker_id').notNull(),
  kind: text('kind').$type<CredentialKind>().notNull(),
  number: text('number').notNull(),
  issuingState: text('issuing_state'),
  licenceClass: text('licence_class'),
  issuedOn: date('issued_on'),
  expiresOn: date('expires_on'),
  fileIds: uuid('file_ids').array().notNull(),
  status: text('status').$type<'recorded' | 'sighted'>().notNull().default('recorded'),
  sightedBy: uuid('sighted_by'),
  sightedAt: timestamp('sighted_at', { withTimezone: true }),
  ...audit,
});

/** The company's own compliance documents (compliance/05). Org-level: no project. */
export const complianceDocuments = workforceSchema.table('compliance_documents', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  itemType: text('item_type').notNull(),
  title: text('title').notNull(),
  numberLast4: text('number_last4'),
  numberCheck: text('number_check').$type<'format_ok'>(),
  issuingState: text('issuing_state'),
  licenceClass: text('licence_class'),
  insurer: text('insurer'),
  limitCents: bigint('limit_cents', { mode: 'number' }),
  startsOn: date('starts_on'),
  expiresOn: date('expires_on'),
  fileIds: uuid('file_ids').array().notNull(),
  evidence: text('evidence').$type<'recorded' | 'sighted' | 'self_declared'>().notNull(),
  sightedBy: uuid('sighted_by'),
  sightedAt: timestamp('sighted_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...audit,
});

/** A builder's request for read access to a subcontractor's wallet, redeemed with a share code (hash only). */
export const complianceAccessRequests = workforceSchema.table('compliance_access_requests', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  requesterName: text('requester_name').notNull(),
  projectId: uuid('project_id'),
  projectName: text('project_name'),
  allProjects: boolean('all_projects').notNull(),
  itemTypes: text('item_types').array().notNull(),
  grantExpiresOn: date('grant_expires_on').notNull(),
  codeHash: text('code_hash').notNull(),
  codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }).notNull(),
  status: text('status').$type<'requested' | 'accepted' | 'cancelled'>().notNull(),
  acceptedOrgId: uuid('accepted_org_id'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

/** Read access a subcontractor has given a builder. Lives in the subbie's org. */
export const complianceGrants = workforceSchema.table('compliance_grants', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  granteeOrgId: uuid('grantee_org_id').notNull(),
  granteeName: text('grantee_name').notNull(),
  grantorName: text('grantor_name').notNull(),
  requestId: uuid('request_id').notNull(),
  itemTypes: text('item_types').array().notNull(),
  projectId: uuid('project_id'),
  projectName: text('project_name'),
  allProjects: boolean('all_projects').notNull(),
  expiresOn: date('expires_on').notNull(),
  acceptedBy: uuid('accepted_by').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const complianceAccessLog = workforceSchema.table('compliance_access_log', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  grantId: uuid('grant_id').notNull(),
  granteeOrgId: uuid('grantee_org_id').notNull(),
  granteeName: text('grantee_name').notNull(),
  documentId: uuid('document_id'),
  itemType: text('item_type'),
  fileId: uuid('file_id'),
  kind: text('kind').$type<'list' | 'document' | 'file'>().notNull(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

export const complianceRelianceSnapshots = workforceSchema.table('compliance_reliance_snapshots', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  grantId: uuid('grant_id').notNull(),
  subbieOrgId: uuid('subbie_org_id').notNull(),
  subbieName: text('subbie_name').notNull(),
  documentId: uuid('document_id').notNull(),
  itemType: text('item_type').notNull(),
  projectId: uuid('project_id'),
  reason: text('reason').$type<'site_entry' | 'claim_assessment' | 'other'>().notNull(),
  dto: jsonb('dto').$type<Record<string, unknown>>().notNull(),
  sha256: text('sha256').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Expiry alerts raised by the daily wallet job (compliance/05 §6). The job inserts these with raw SQL. */
export const complianceExpiryAlerts = workforceSchema.table('compliance_expiry_alerts', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  documentId: uuid('document_id').notNull(),
  threshold: integer('threshold').notNull().$type<number>(),
  expiresOn: date('expires_on').notNull(),
  raisedOn: date('raised_on').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
