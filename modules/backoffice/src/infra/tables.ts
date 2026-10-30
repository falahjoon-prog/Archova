import {
  boolean,
  customType,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const backofficeSchema = pgSchema('backoffice');

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const staffUsers = backofficeSchema.table('staff_users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash'),
  idpSubject: text('idp_subject'),
  status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
});

export const staffRoleAssignments = backofficeSchema.table('staff_role_assignments', {
  id: uuid('id').primaryKey(),
  staffUserId: uuid('staff_user_id').notNull(),
  role: text('role').notNull(),
  grantedBy: uuid('granted_by'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const staffSessions = backofficeSchema.table('staff_sessions', {
  id: uuid('id').primaryKey(),
  staffUserId: uuid('staff_user_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  authTime: timestamp('auth_time', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

export const requests = backofficeSchema.table('requests', {
  id: uuid('id').primaryKey(),
  kind: text('kind').notNull(),
  targetOrgId: uuid('target_org_id'),
  subjectRef: text('subject_ref').notNull(),
  subjectLabel: text('subject_label').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  preview: jsonb('preview').$type<Record<string, unknown> | null>(),
  reason: text('reason').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  status: text('status').notNull().default('pending'),
  decisionReason: text('decision_reason'),
  approvedBy: uuid('approved_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  soloOwnerMode: boolean('solo_owner_mode').notNull().default(false),
  coolingOffUntil: timestamp('cooling_off_until', { withTimezone: true }),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  result: jsonb('result').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tenantDirectory = backofficeSchema.table('tenant_directory', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  planCode: text('plan_code').notNull(),
  state: text('state').notNull(),
  seats: integer('seats'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  cell: text('cell').notNull().default('local'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cohorts = backofficeSchema.table('cohorts', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cohortMembers = backofficeSchema.table(
  'cohort_members',
  {
    cohortId: uuid('cohort_id').notNull(),
    orgId: uuid('member_org_id').notNull(),
    addedBy: uuid('added_by'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.cohortId, t.orgId] })],
);

export const flags = backofficeSchema.table('flags', {
  key: text('key').primaryKey(),
  enabledForAll: boolean('enabled_for_all').notNull().default(false),
  percent: integer('percent').notNull().default(0),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const flagTargets = backofficeSchema.table(
  'flag_targets',
  {
    flagKey: text('flag_key').notNull(),
    kind: text('kind').$type<'org' | 'cohort'>().notNull(),
    refId: uuid('ref_id').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.flagKey, t.kind, t.refId] })],
);

export const flagChanges = backofficeSchema.table('flag_changes', {
  id: uuid('id').primaryKey(),
  flagKey: text('flag_key'),
  cohortId: uuid('cohort_id'),
  summary: text('summary').notNull(),
  reason: text('reason'),
  ticketRef: text('ticket_ref'),
  staffId: uuid('staff_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgActions = backofficeSchema.table('org_actions', {
  id: uuid('id').primaryKey(),
  targetOrgId: uuid('target_org_id').notNull(),
  kind: text('kind').$type<'trial.extend' | 'plan.change' | 'suspend' | 'reactivate'>().notNull(),
  summary: text('summary').notNull(),
  reason: text('reason').notNull(),
  ticketRef: text('ticket_ref').notNull(),
  staffId: uuid('staff_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
