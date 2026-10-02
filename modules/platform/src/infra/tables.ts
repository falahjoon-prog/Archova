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
import type { Address } from '@archova/contracts';
import type { AuState, CompanyType, OrgKind, ProjectStatus } from '@archova/domain';
import type { OrgRole } from '@archova/domain/permissions';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const platform = pgSchema('platform');

const audit = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
};

export const orgs = platform.table('orgs', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  abn: text('abn'),
  slug: text('slug').notNull(),
  country: text('country').notNull(),
  defaultState: text('default_state'),
  timezone: text('timezone').notNull(),
  logoFileId: uuid('logo_file_id'),
  verifiedDomains: citext('verified_domains').array().notNull().default([]),
  settings: jsonb('settings').notNull().default({}),
  kind: text('kind').$type<OrgKind>().notNull(),
  kmsKeyId: text('kms_key_id'),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const memberships = platform.table('memberships', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  role: text('role').$type<OrgRole>().notNull(),
  status: text('status').$type<'invited' | 'active' | 'suspended'>().notNull(),
  invitedBy: uuid('invited_by'),
  joinedAt: timestamp('joined_at', { withTimezone: true }),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
  ...audit,
});

export const companies = platform.table('companies', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  abn: text('abn'),
  type: text('type').$type<CompanyType>().notNull(),
  trades: text('trades').array().notNull().default([]),
  email: text('email'),
  phone: text('phone'),
  address: jsonb('address'),
  insurances: jsonb('insurances'),
  isOwnCompany: boolean('is_own_company').notNull().default(false),
  linkedOrgId: uuid('linked_org_id'),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const projects = platform.table('projects', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  name: text('name').notNull(),
  number: text('number'),
  status: text('status').$type<ProjectStatus>().notNull(),
  address: jsonb('address').$type<Address>(),
  state: text('state').$type<AuState>(),
  timezone: text('timezone').notNull(),
  siteLat: doublePrecision('site_lat'),
  siteLng: doublePrecision('site_lng'),
  geofenceRadiusM: integer('geofence_radius_m'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  contractValue: numeric('contract_value', { precision: 18, scale: 2 }),
  isInternalTest: boolean('is_internal_test').notNull().default(false),
  clientCompanyId: uuid('client_company_id'),
  custom: jsonb('custom').notNull().default({}),
  ...audit,
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const projectMembers = platform.table('project_members', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  userId: uuid('user_id').notNull(),
  companyId: uuid('company_id').notNull(),
  permissionTemplateId: uuid('permission_template_id').notNull(),
  isExternal: boolean('is_external').notNull().default(false),
  status: text('status').$type<'active' | 'removed'>().notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  ...audit,
});
