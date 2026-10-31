import {
  boolean,
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
  sovItemId: uuid('sov_item_id').notNull(),
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
