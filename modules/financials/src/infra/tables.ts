import {
  boolean,
  customType,
  date,
  doublePrecision,
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
  sourcePackageId: uuid('source_package_id'),
  sourceQuoteId: uuid('source_quote_id'),
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
  costCodeId: uuid('cost_code_id'),
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
  costCodeId: uuid('cost_code_id'),
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

export const evidenceSignatures = financialsSchema.table('evidence_signatures', {
  evidenceId: uuid('evidence_id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  keyId: text('key_id').notNull(),
  algorithm: text('algorithm').$type<'ed25519'>().notNull(),
  message: text('message').notNull(),
  signature: text('signature').notNull(),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceTimestamps = financialsSchema.table('evidence_timestamps', {
  evidenceId: uuid('evidence_id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  authority: text('authority').notNull(),
  imprintSha256: text('imprint_sha256').notNull(),
  genTime: timestamp('gen_time', { withTimezone: true }).notNull(),
  serialHex: text('serial_hex').notNull(),
  token: bytea('token').notNull(),
  caChainPem: text('ca_chain_pem').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceDeliveries = financialsSchema.table('evidence_deliveries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  kind: text('kind').$type<'claim' | 'schedule'>().notNull(),
  recipientEmail: text('recipient_email').notNull(),
  addressBasis: text('address_basis'),
  status: text('status')
    .$type<'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'failed'>()
    .notNull()
    .default('queued'),
  attempts: integer('attempts').notNull().default(0),
  queuedBy: uuid('queued_by'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  sendingAt: timestamp('sending_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  providerMessageId: text('provider_message_id'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  bouncedAt: timestamp('bounced_at', { withTimezone: true }),
  lastError: text('last_error'),
});

export const evidenceSendProofs = financialsSchema.table('evidence_send_proofs', {
  deliveryId: uuid('delivery_id').primaryKey(),
  id: uuid('id').notNull().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  provider: text('provider').$type<'ses' | 'smtp' | 'log'>().notNull(),
  recipientEmail: text('recipient_email').notNull(),
  providerMessageId: text('provider_message_id'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  message: text('message').notNull(),
  messageSha256: text('message_sha256').notNull(),
  contentSha256: text('content_sha256').notNull(),
  addressBasis: text('address_basis'),
  rawMessage: bytea('raw_message'),
  rawSha256: text('raw_sha256'),
  serverResponse: text('server_response'),
  keyId: text('key_id'),
  signature: text('signature'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceSendTimestamps = financialsSchema.table('evidence_send_timestamps', {
  deliveryId: uuid('delivery_id').primaryKey(),
  id: uuid('id').notNull().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  authority: text('authority').notNull(),
  imprintSha256: text('imprint_sha256').notNull(),
  genTime: timestamp('gen_time', { withTimezone: true }).notNull(),
  serialHex: text('serial_hex').notNull(),
  token: bytea('token').notNull(),
  caChainPem: text('ca_chain_pem').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceServiceRecords = financialsSchema.table('evidence_service_records', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  evidenceId: uuid('evidence_id').notNull(),
  kind: text('kind').$type<'claim' | 'schedule'>().notNull(),
  method: text('method')
    .$type<'hand' | 'courier' | 'post' | 'recipient_reply' | 'other'>()
    .notNull(),
  servedAt: timestamp('served_at', { withTimezone: true }).notNull(),
  servedTo: text('served_to').notNull(),
  note: text('note'),
  basis: text('basis').$type<'self_reported'>().notNull().default('self_reported'),
  recordedBy: uuid('recorded_by'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceArchive = financialsSchema.table('evidence_archive', {
  deliveryId: uuid('delivery_id').primaryKey(),
  id: uuid('id').notNull().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  objectKey: text('object_key').notNull(),
  rawSha256: text('raw_sha256').notNull(),
  storedSha256: text('stored_sha256'),
  archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceServiceVoids = financialsSchema.table('evidence_service_voids', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  recordId: uuid('record_id').notNull(),
  reason: text('reason').notNull(),
  voidedBy: uuid('voided_by'),
  voidedAt: timestamp('voided_at', { withTimezone: true }).notNull().defaultNow(),
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

export const budgetForecastEntries = financialsSchema.table('budget_forecast_entries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  budgetLineId: uuid('budget_line_id').notNull(),
  /** First day of the month. */
  month: date('month').notNull(),
  amount: money('amount').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
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

export interface SnapshotLine {
  costCodeId: string;
  code: string;
  codeDescription: string;
  description: string;
  original: string;
  approvedChanges: string;
  revised: string;
  isMargin: boolean;
}

export const budgetSnapshots = financialsSchema.table('budget_snapshots', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  budgetId: uuid('budget_id').notNull(),
  name: text('name').notNull(),
  note: text('note'),
  lines: jsonb('lines').$type<SnapshotLine[]>().notNull(),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  takenBy: uuid('taken_by'),
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
  costCodeId: uuid('cost_code_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const commitments = financialsSchema.table('commitments', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  kind: text('kind').$type<'subcontract' | 'purchase_order'>().notNull(),
  title: text('title').notNull(),
  vendorCompanyId: uuid('vendor_company_id'),
  status: text('status').notNull().default('draft'),
  total: money('total').notNull(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by'),
  decisionNote: text('decision_note'),
  overBudgetOverride: boolean('over_budget_override').notNull().default(false),
  sourcePackageId: uuid('source_package_id'),
  sourceQuoteId: uuid('source_quote_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const commitmentLines = financialsSchema.table('commitment_lines', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  commitmentId: uuid('commitment_id').notNull(),
  budgetLineId: uuid('budget_line_id').notNull(),
  description: text('description').notNull(),
  amount: money('amount').notNull(),
  sort: integer('sort').notNull(),
});

export const commitmentChangeOrders = financialsSchema.table('commitment_change_orders', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  commitmentId: uuid('commitment_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  budgetLineId: uuid('budget_line_id').notNull(),
  amount: money('amount').notNull(),
  status: text('status')
    .$type<'draft' | 'submitted' | 'approved' | 'rejected'>()
    .notNull()
    .default('draft'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by'),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const commitmentPayments = financialsSchema.table('commitment_payments', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  commitmentId: uuid('commitment_id').notNull(),
  number: integer('number').notNull(),
  amount: money('amount').notNull(),
  paidOn: date('paid_on').notNull(),
  reference: text('reference'),
  status: text('status').$type<'recorded' | 'void'>().notNull().default('recorded'),
  voidReason: text('void_reason'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const directCosts = financialsSchema.table('direct_costs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  budgetLineId: uuid('budget_line_id').notNull(),
  category: text('category').$type<'labour' | 'materials' | 'plant' | 'fees' | 'other'>().notNull(),
  description: text('description').notNull(),
  supplier: text('supplier'),
  reference: text('reference'),
  incurredOn: date('incurred_on').notNull(),
  amount: money('amount').notNull(),
  gst: money('gst').notNull().default('0'),
  status: text('status').$type<'recorded' | 'void'>().notNull().default('recorded'),
  voidReason: text('void_reason'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const tmTickets = financialsSchema.table('tm_tickets', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  workDate: date('work_date').notNull(),
  location: text('location'),
  contractor: text('contractor'),
  instructedBy: text('instructed_by'),
  reference: text('reference'),
  notes: text('notes'),
  reviewStage: text('review_stage')
    .$type<'in_progress' | 'ready_for_review' | 'field_verified'>()
    .notNull()
    .default('in_progress'),
  readyAt: timestamp('ready_at', { withTimezone: true }),
  readyBy: uuid('ready_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedBy: uuid('verified_by'),
  verifyNote: text('verify_note'),
  origin: text('origin').$type<'manual' | 'nova'>().notNull().default('manual'),
  status: text('status')
    .$type<'draft' | 'part_signed' | 'signed' | 'converted' | 'void'>()
    .notNull()
    .default('draft'),
  total: money('total').notNull().default('0'),
  convertedTo: text('converted_to').$type<'direct_cost' | 'variation'>(),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  convertedBy: uuid('converted_by'),
  variationId: uuid('variation_id'),
  voidReason: text('void_reason'),
  voidedAt: timestamp('voided_at', { withTimezone: true }),
  voidedBy: uuid('voided_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const tmTicketLines = financialsSchema.table('tm_ticket_lines', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  ticketId: uuid('ticket_id').notNull(),
  sort: integer('sort').notNull(),
  kind: text('kind').$type<'labour' | 'equipment' | 'material'>().notNull(),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull(),
  unit: text('unit').notNull(),
  rate: money('rate').notNull(),
  amount: money('amount').notNull(),
  sourceType: text('source_type').$type<'timesheet_line' | 'equipment_log'>(),
  sourceId: uuid('source_id'),
});

export const tmTicketSignoffs = financialsSchema.table('tm_ticket_signoffs', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  ticketId: uuid('ticket_id').notNull(),
  role: text('role').$type<'contractor' | 'principal_rep'>().notNull(),
  signerName: text('signer_name').notNull(),
  signerPosition: text('signer_position'),
  signedBy: uuid('signed_by').notNull(),
  contentHash: text('content_hash').notNull(),
  esignRequestId: uuid('esign_request_id'),
  evidenceFileId: uuid('evidence_file_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  accuracyM: integer('accuracy_m'),
  geofenceStatus: text('geofence_status')
    .$type<'inside' | 'outside' | 'uncertain' | 'unknown'>()
    .notNull()
    .default('unknown'),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tmTicketDirectCosts = financialsSchema.table('tm_ticket_direct_costs', {
  orgId: uuid('org_id').notNull(),
  ticketId: uuid('ticket_id').notNull(),
  directCostId: uuid('direct_cost_id').notNull(),
});

export const trustAccounts = financialsSchema.table('trust_accounts', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  contractId: uuid('contract_id').notNull(),
  governmentClient: boolean('government_client').notNull().default(false),
  institution: text('institution'),
  accountName: text('account_name'),
  accountLast4: text('account_last4'),
  openedOn: date('opened_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

export const trustMovements = financialsSchema.table('trust_movements', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  trustAccountId: uuid('trust_account_id').notNull(),
  kind: text('kind').$type<'deposit' | 'interest' | 'release' | 'reversal'>().notNull(),
  amount: money('amount').notNull(),
  movedOn: date('moved_on').notNull(),
  reference: text('reference').notNull(),
  note: text('note'),
  reversesMovementId: uuid('reverses_movement_id'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedBy: uuid('recorded_by'),
});

/** NSW subcontractor's statement for one payment claim (compliance/05 §6). Never blocks a claim or a schedule. */
export const claimStatements = financialsSchema.table('claim_statements', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  periodEnd: date('period_end').notNull(),
  receivedOn: date('received_on').notNull(),
  signedOn: date('signed_on'),
  note: text('note'),
  recordedBy: uuid('recorded_by'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
});

export const retentionTerms = financialsSchema.table('retention_terms', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  contractId: uuid('contract_id').notNull(),
  practicalCompletionOn: date('practical_completion_on'),
  defectsPeriodDays: integer('defects_period_days'),
  firstReleasePct: numeric('first_release_pct', { precision: 5, scale: 2 }).notNull().default('50'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

export const retentionReleases = financialsSchema.table('retention_releases', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  contractId: uuid('contract_id').notNull(),
  stage: text('stage').$type<'practical_completion' | 'defects_end'>().notNull(),
  amount: money('amount').notNull(),
  releasedOn: date('released_on').notNull(),
  reference: text('reference').notNull(),
  note: text('note'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  recordedBy: uuid('recorded_by'),
});

export const costCodeProduction = financialsSchema.table('cost_code_production', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  costCodeId: uuid('cost_code_id').notNull(),
  uom: text('uom').notNull(),
  budgetedHours: numeric('budgeted_hours', { precision: 12, scale: 2 }).notNull(),
  budgetedQuantity: numeric('budgeted_quantity', { precision: 14, scale: 2 }).notNull(),
  quantityComplete: numeric('quantity_complete', { precision: 14, scale: 2 })
    .notNull()
    .default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

export const productionLog = financialsSchema.table('production_log', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  costCodeId: uuid('cost_code_id').notNull(),
  loggedOn: date('logged_on').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 2 }).notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const productionItems = financialsSchema.table('production_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  name: text('name').notNull(),
  uom: text('uom').notNull(),
  trade: text('trade'),
  location: text('location'),
  plannedQuantity: numeric('planned_quantity', { precision: 14, scale: 2 }).notNull(),
  plannedStart: date('planned_start').notNull(),
  plannedFinish: date('planned_finish').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});

export const productionEntries = financialsSchema.table('production_entries', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  itemId: uuid('item_id').notNull(),
  loggedOn: date('logged_on').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 2 }).notNull(),
  crew: text('crew'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const ownerInvoices = financialsSchema.table('owner_invoices', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  contractId: uuid('contract_id').notNull(),
  number: integer('number').notNull(),
  periodEnd: date('period_end').notNull(),
  markupPct: numeric('markup_pct', { precision: 6, scale: 2 }).notNull(),
  subTotal: money('sub_total').notNull(),
  markupAmount: money('markup_amount').notNull(),
  total: money('total').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  version: integer('version').notNull().default(1),
});

export const ownerInvoiceSources = financialsSchema.table('owner_invoice_sources', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  ownerInvoiceId: uuid('owner_invoice_id').notNull(),
  claimId: uuid('claim_id').notNull(),
  amount: money('amount').notNull(),
  flags: jsonb('flags').$type<{ code: string; message: string }[]>().notNull(),
  flagsConfirmedBy: uuid('flags_confirmed_by'),
  flagsConfirmedAt: timestamp('flags_confirmed_at', { withTimezone: true }),
});
