import { boolean, char, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const contractorsSchema = pgSchema('contractors');

export const LINK_STATUSES = [
  'requested',
  'accepted',
  'rejected',
  'ended',
  'cancelled',
  'blocked',
] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

export const profiles = contractorsSchema.table('profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name').notNull(),
  profession: text('profession').notNull(),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const directory = contractorsSchema.table('directory', {
  companyId: uuid('company_id').primaryKey(),
  listingId: uuid('listing_id').notNull(),
  name: text('name').notNull(),
  abnLast3: char('abn_last3', { length: 3 }),
  listed: boolean('listed').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const links = contractorsSchema.table('links', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  contractorUserId: uuid('contractor_user_id').notNull(),
  companyName: text('company_name').notNull(),
  status: text('status').$type<LinkStatus>().notNull().default('requested'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Company-internal: who decided and why. No self policy; the contractor never reads it. */
export const linkDecisions = contractorsSchema.table('link_decisions', {
  orgId: uuid('org_id').notNull(),
  linkId: uuid('link_id').primaryKey(),
  decidedBy: uuid('decided_by').notNull(),
  reason: text('reason'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
});
