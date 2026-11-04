import { bigint, boolean, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const billingSchema = pgSchema('billing');

export type CatalogueStatus = 'draft' | 'pending_approval' | 'published' | 'retired';
export type PriceBookStatus = CatalogueStatus | 'scheduled';

export const plans = billingSchema.table('plans', {
  code: text('code').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const planVersions = billingSchema.table('plan_versions', {
  id: uuid('id').primaryKey(),
  planCode: text('plan_code').notNull(),
  version: integer('version').notNull(),
  status: text('status').$type<CatalogueStatus>().notNull(),
  name: text('name').notNull(),
  blurb: text('blurb').notNull(),
  features: text('features').array().notNull(),
  modules: text('modules').array().notNull(),
  aiCreditsMonthly: integer('ai_credits_monthly'),
  ctaLabel: text('cta_label').notNull(),
  ctaHref: text('cta_href').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by'),
});

export const priceBooks = billingSchema.table('price_books', {
  id: uuid('id').primaryKey(),
  seq: integer('seq').notNull(),
  version: text('version').notNull(),
  status: text('status').$type<PriceBookStatus>().notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  previousId: uuid('previous_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedBy: uuid('published_by'),
});

export const prices = billingSchema.table('prices', {
  priceBookId: uuid('price_book_id').notNull(),
  planCode: text('plan_code').notNull(),
  unit: text('unit').$type<'free' | 'user_month' | 'year'>().notNull(),
  fromPrice: boolean('from_price').notNull().default(false),
  amountCents: bigint('amount_cents', { mode: 'number' }),
});

export const orgAccounts = billingSchema.table('org_accounts', {
  id: uuid('id').primaryKey(),
  planCode: text('plan_code').notNull().default('trial'),
  state: text('state')
    .$type<'trialing' | 'active' | 'past_due' | 'read_only' | 'cancelled'>()
    .notNull()
    .default('trialing'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  trialExtendedDays: integer('trial_extended_days').notNull().default(0),
  suspendedCategory: text('suspended_category').$type<SuspendCategory>(),
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SuspendCategory = 'abuse' | 'fraud' | 'security' | 'legal_order';

export const orgDiscounts = billingSchema.table('org_discounts', {
  id: uuid('id').primaryKey(),
  targetOrgId: uuid('target_org_id').notNull(),
  percent: integer('percent').notNull(),
  startsOn: text('starts_on').notNull(),
  endsOn: text('ends_on').notNull(),
  reason: text('reason').notNull(),
  ticketRef: text('ticket_ref').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by'),
});

export const orgOverrides = billingSchema.table('org_overrides', {
  id: uuid('id').primaryKey(),
  targetOrgId: uuid('target_org_id').notNull(),
  kind: text('kind').$type<'module' | 'limit'>().notNull(),
  key: text('key').notNull(),
  limitValue: integer('limit_value'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
  ticketRef: text('ticket_ref').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedBy: uuid('revoked_by'),
});

export type RefundStatus = 'pending_approval' | 'approved' | 'cancelled';

export const orgRefunds = billingSchema.table('org_refunds', {
  id: uuid('id').primaryKey(),
  targetOrgId: uuid('target_org_id').notNull(),
  invoiceRef: text('invoice_ref').notNull(),
  amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
  paidCents: bigint('paid_cents', { mode: 'number' }).notNull(),
  reason: text('reason').notNull(),
  ticketRef: text('ticket_ref').notNull(),
  status: text('status').$type<RefundStatus>().notNull(),
  requestedBy: uuid('requested_by').notNull(),
  approvedBy: uuid('approved_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
