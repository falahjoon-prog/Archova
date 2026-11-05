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

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const estimatingSchema = pgSchema('estimating');

export type PackageStatus = 'draft' | 'out_to_tender' | 'closed' | 'awarded' | 'cancelled';
export type InviteStatus = 'invited' | 'viewed' | 'declined' | 'intends_to_quote' | 'submitted';
export type QuoteStatus = 'reading' | 'ready_to_review' | 'confirmed' | 'superseded' | 'declined';

export interface ScopeLine {
  key: string;
  description: string;
  quantity: string | null;
  unit: string;
  source: 'typed' | 'csv' | 'takeoff';
}
export interface PackageDocument {
  kind: 'drawing_revision' | 'document';
  id: string;
}
export interface SourceRef {
  page: number;
  snippet: string;
}
export interface QuoteNote {
  id: string;
  text: string;
  scopeKey: string | null;
  source: SourceRef | null;
}

export const tenderPackages = estimatingSchema.table('tender_packages', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  trade: text('trade').notNull(),
  status: text('status').$type<PackageStatus>().notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  scope: jsonb('scope').$type<ScopeLine[]>().notNull().default([]),
  documents: jsonb('documents').$type<PackageDocument[]>().notNull().default([]),
  allowances: jsonb('allowances').$type<Record<string, string>>().notNull().default({}),
  awardedQuoteId: uuid('awarded_quote_id'),
  awardedBy: uuid('awarded_by'),
  awardedAt: timestamp('awarded_at', { withTimezone: true }),
  awardReason: text('award_reason'),
  awardNotLowest: boolean('award_not_lowest'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const packageInvites = estimatingSchema.table('package_invites', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  packageId: uuid('package_id').notNull(),
  companyId: uuid('company_id').notNull(),
  contactEmail: citext('contact_email'),
  status: text('status').$type<InviteStatus>().notNull().default('invited'),
  invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
  viewedAt: timestamp('viewed_at', { withTimezone: true }),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  accessLinkId: uuid('access_link_id'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
});

export const quotes = estimatingSchema.table('quotes', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  packageId: uuid('package_id').notNull(),
  companyId: uuid('company_id').notNull(),
  revision: integer('revision').notNull().default(1),
  status: text('status').$type<QuoteStatus>().notNull(),
  reference: text('reference'),
  fileIds: uuid('file_ids').array().notNull().default([]),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  validUntil: date('valid_until'),
  totalExGst: numeric('total_ex_gst', { precision: 18, scale: 2 }).notNull().default('0'),
  gst: numeric('gst', { precision: 18, scale: 2 }).notNull().default('0'),
  currency: text('currency').notNull().default('AUD'),
  exclusions: jsonb('exclusions').$type<QuoteNote[]>().notNull().default([]),
  qualifications: jsonb('qualifications').$type<QuoteNote[]>().notNull().default([]),
  source: text('source').$type<'manual' | 'ai_extracted'>().notNull().default('manual'),
  aiSuggestionId: uuid('ai_suggestion_id'),
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const quoteLines = estimatingSchema.table('quote_lines', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  quoteId: uuid('quote_id').notNull(),
  sort: integer('sort').notNull(),
  scopeKey: text('scope_key'),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 3 }),
  unit: text('unit').notNull().default('item'),
  rate: numeric('rate', { precision: 18, scale: 2 }),
  amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  isProvisional: boolean('is_provisional').notNull().default(false),
  originalAmount: numeric('original_amount', { precision: 18, scale: 2 }),
  sourcePage: integer('source_page'),
  sourceSnippet: text('source_snippet'),
});

export type MeasurementKind = 'length' | 'area' | 'count';
export type MeasurementSource = 'manual' | 'assisted' | 'auto';

export const takeoffMeasurements = estimatingSchema.table('takeoff_measurements', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  label: text('label').notNull(),
  kind: text('kind').$type<MeasurementKind>().notNull(),
  geometry: jsonb('geometry')
    .$type<{
      type: 'polyline' | 'polygon' | 'points';
      points: number[][];
      holes?: number[][][];
    }>()
    .notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
  unit: text('unit').notNull(),
  source: text('source').$type<MeasurementSource>().notNull().default('manual'),
  confidence: real('confidence'),
  packageId: uuid('package_id'),
  scopeKey: text('scope_key'),
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type CostCategory = 'labour' | 'material' | 'plant' | 'subcontract' | 'other';

/** The company's cost library: what an item is. Its prices are `costRates`, kept as history. */
export const bidderLists = estimatingSchema.table('bidder_lists', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  trade: text('trade').notNull().default(''),
  companyIds: uuid('company_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const costItems = estimatingSchema.table('cost_items', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  code: text('code').notNull(),
  description: text('description').notNull(),
  unit: text('unit').notNull(),
  trade: text('trade').notNull().default(''),
  category: text('category').$type<CostCategory>().notNull().default('other'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const costRates = estimatingSchema.table('cost_rates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  costItemId: uuid('cost_item_id').notNull(),
  rate: numeric('rate', { precision: 18, scale: 2 }).notNull(),
  region: text('region'),
  effectiveFrom: date('effective_from').notNull(),
  source: text('source').$type<'manual' | 'quote' | 'import'>().notNull().default('manual'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export type EstimateStatus = 'draft' | 'issued';
export type MarginBasis = 'markup' | 'margin';

export const estimates = estimatingSchema.table('estimates', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  status: text('status').$type<EstimateStatus>().notNull().default('draft'),
  baseDate: date('base_date').notNull(),
  region: text('region'),
  contingencyPct: numeric('contingency_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  marginPct: numeric('margin_pct', { precision: 5, scale: 2 }).notNull().default('0'),
  marginBasis: text('margin_basis').$type<MarginBasis>().notNull().default('markup'),
  gstPct: numeric('gst_pct', { precision: 5, scale: 2 }).notNull().default('10'),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
  issuedBy: uuid('issued_by'),
  totalExGst: numeric('total_ex_gst', { precision: 18, scale: 2 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type EstimateLineKind = 'section' | 'item';

export const estimateLines = estimatingSchema.table('estimate_lines', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  estimateId: uuid('estimate_id').notNull(),
  parentId: uuid('parent_id'),
  kind: text('kind').$type<EstimateLineKind>().notNull(),
  sort: integer('sort').notNull().default(0),
  costItemId: uuid('cost_item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 18, scale: 3 }),
  unit: text('unit'),
  rate: numeric('rate', { precision: 18, scale: 2 }),
  measurementIds: uuid('measurement_ids').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
});
