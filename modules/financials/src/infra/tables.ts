import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ContractKind, SopaState } from '@archova/domain';

export const financialsSchema = pgSchema('financials');

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

export const contracts = financialsSchema.table('contracts', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  kind: text('kind').$type<ContractKind>().notNull(),
  title: text('title').notNull(),
  payerCompanyId: uuid('payer_company_id'),
  payeeCompanyId: uuid('payee_company_id'),
  status: text('status').notNull().default('draft'),
  originalValue: money('original_value').notNull(),
  retentionPct: numeric('retention_pct', { precision: 5, scale: 2 }).notNull(),
  retentionCapPct: numeric('retention_cap_pct', { precision: 5, scale: 2 }),
  sopaState: text('sopa_state').$type<SopaState | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT'>().notNull(),
  scheduleDays: integer('schedule_days'),
  paymentDays: integer('payment_days'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const sovItems = financialsSchema.table('sov_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  contractId: uuid('contract_id').notNull(),
  code: text('code').notNull(),
  description: text('description').notNull(),
  value: money('value').notNull(),
  sort: integer('sort').notNull(),
});

export const variations = financialsSchema.table('variations', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  contractId: uuid('contract_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  amount: money('amount').notNull(),
  timeImpactDays: integer('time_impact_days').notNull().default(0),
  status: text('status').notNull().default('draft'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by'),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const paymentClaims = financialsSchema.table('payment_claims', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  contractId: uuid('contract_id').notNull(),
  number: integer('number').notNull(),
  periodEnd: date('period_end').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
  statesAct: boolean('states_act').notNull(),
  isValid: boolean('is_valid').notNull(),
  invalidReason: text('invalid_reason'),
  claimedGross: money('claimed_gross').notNull(),
  lessPrevious: money('less_previous').notNull(),
  retention: money('retention').notNull(),
  claimedNet: money('claimed_net').notNull(),
  gst: money('gst').notNull(),
  claimedTotal: money('claimed_total').notNull(),
  servedOn: date('served_on'),
  scheduleDueOn: date('schedule_due_on'),
  paymentDueOn: date('payment_due_on'),
  paymentReadDown: boolean('payment_read_down').notNull().default(false),
  ruleState: text('rule_state'),
  rulesReviewed: boolean('rules_reviewed').notNull().default(false),
  status: text('status').notNull().default('submitted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const paymentClaimLines = financialsSchema.table('payment_claim_lines', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  sovItemId: uuid('sov_item_id'),
  variationId: uuid('variation_id'),
  previous: money('previous').notNull(),
  thisClaim: money('this_claim').notNull(),
  toDate: money('to_date').notNull(),
});

export const paymentSchedules = financialsSchema.table('payment_schedules', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  scheduledAmount: money('scheduled_amount').notNull(),
  withheldAmount: money('withheld_amount').notNull(),
  overallReason: text('overall_reason'),
  lineReasons: jsonb('line_reasons').$type<{ sovItemId: string; reason: string }[]>().notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  issuedBy: uuid('issued_by'),
  issuedWithinTime: boolean('issued_within_time').notNull(),
});

export const payments = financialsSchema.table('payments', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  paidOn: date('paid_on').notNull(),
  amount: money('amount').notNull(),
  reference: text('reference').notNull(),
  source: text('source').$type<'manual' | 'xero' | 'myob'>().notNull(),
  externalRef: text('external_ref'),
  reversesPaymentId: uuid('reverses_payment_id'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceRecords = financialsSchema.table('evidence_records', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  kind: text('kind').$type<'claim' | 'schedule'>().notNull(),
  sealedAt: timestamp('sealed_at', { withTimezone: true }).notNull(),
  snapshot: jsonb('snapshot').notNull(),
  snapshotText: text('snapshot_text').notNull(),
  snapshotSha256: text('snapshot_sha256').notNull(),
  pdf: bytea('pdf').notNull(),
  pdfSha256: text('pdf_sha256').notNull(),
});

export const costCodes = financialsSchema.table('cost_codes', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  code: text('code').notNull(),
  description: text('description').notNull(),
  parentId: uuid('parent_id'),
  archived: boolean('archived').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const budgets = financialsSchema.table('budgets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  status: text('status').$type<'draft' | 'locked'>().notNull().default('draft'),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  lockedBy: uuid('locked_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const budgetLines = financialsSchema.table('budget_lines', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  budgetId: uuid('budget_id').notNull(),
  costCodeId: uuid('cost_code_id').notNull(),
  description: text('description').notNull().default(''),
  original: money('original').notNull(),
  approvedChanges: money('approved_changes').notNull().default('0'),
  committed: money('committed').notNull().default('0'),
  actual: money('actual').notNull().default('0'),
  forecastToComplete: money('forecast_to_complete').notNull().default('0'),
  isMargin: boolean('is_margin').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const budgetAdjustments = financialsSchema.table('budget_adjustments', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  budgetLineId: uuid('budget_line_id').notNull(),
  amount: money('amount').notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const forecastAdjustments = financialsSchema.table('forecast_adjustments', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  contractId: uuid('contract_id'),
  category: text('category')
    .$type<'unawarded_work' | 'allowance' | 'risk' | 'saving' | 'other'>()
    .notNull(),
  label: text('label').notNull(),
  note: text('note'),
  amount: money('amount').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});
