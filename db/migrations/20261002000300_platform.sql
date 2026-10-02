-- Composed from modules/platform/db/migrations/20261002000300_platform.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- platform: orgs, memberships, invitations, companies, projects, project members (backend schema/platform.md).
-- project_locations, cost_codes, custom_field_defs, saved_views and company_contacts come with the features that use them.

create schema if not exists platform;

-- The tenant. Its RLS key is `id`, not `org_id`.
create table platform.orgs (
  id               uuid primary key,
  name             text not null,
  legal_name       text,
  abn              char(11),
  slug             text not null unique,
  country          char(2) not null default 'AU',
  default_state    text,
  timezone         kernel.time_zone not null default 'Australia/Sydney',
  logo_file_id     uuid,
  verified_domains citext[] not null default '{}',
  settings         jsonb not null default '{}',
  kind             text not null default 'builder' check (kind in ('builder', 'subcontractor_free')),
  kms_key_id       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1,
  deleted_at       timestamptz
);
select kernel.enable_tenant_rls('platform.orgs', 'id');

create table platform.memberships (
  id             uuid primary key,
  org_id         uuid not null references platform.orgs (id),
  user_id        uuid not null,
  role           text not null check (role in ('owner', 'admin', 'billing_admin', 'member')),
  status         text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  invited_by     uuid,
  joined_at      timestamptz,
  last_active_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  version        int not null default 1,
  unique (org_id, user_id)
);
create index memberships_user on platform.memberships (user_id);
select kernel.enable_tenant_rls('platform.memberships');

create table platform.companies (
  id             uuid primary key,
  org_id         uuid not null references platform.orgs (id),
  name           text not null,
  abn            char(11),
  type           text not null check (type in ('builder', 'subcontractor', 'consultant', 'client', 'supplier')),
  trades         text[] not null default '{}',
  email          text,
  phone          text,
  address        jsonb,
  insurances     jsonb,
  is_own_company boolean not null default false,
  linked_org_id  uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  version        int not null default 1,
  deleted_at     timestamptz
);
create index companies_org on platform.companies (org_id, id) where deleted_at is null;
create unique index companies_one_own on platform.companies (org_id) where is_own_company;
select kernel.enable_tenant_rls('platform.companies');

create table platform.projects (
  id                uuid primary key,
  org_id            uuid not null references platform.orgs (id),
  name              text not null,
  number            text,
  status            text not null default 'active' check (status in ('tender', 'active', 'on_hold', 'closed', 'archived')),
  address           jsonb,
  state             text check (state in ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),
  timezone          kernel.time_zone not null,
  -- Site location and geofence (X32): the point check-ins, photos and diaries are measured against.
  site_lat          kernel.latitude,
  site_lng          kernel.longitude,
  geofence_radius_m int check (geofence_radius_m between 10 and 10000),
  start_date        date,
  end_date          date,
  contract_value    numeric(18,2),
  is_internal_test  boolean not null default false,
  client_company_id uuid references platform.companies (id),
  custom            jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  version           int not null default 1,
  deleted_at        timestamptz,
  check ((site_lat is null) = (site_lng is null)),
  check (geofence_radius_m is null or site_lat is not null)
);
create index projects_org on platform.projects (org_id, id) where deleted_at is null;
create unique index projects_number on platform.projects (org_id, number) where deleted_at is null and number is not null;
select kernel.enable_tenant_rls('platform.projects');

-- permission_template_id references access.permission_templates; no cross-module FK (schema README).
create table platform.project_members (
  id                     uuid primary key,
  org_id                 uuid not null references platform.orgs (id),
  project_id             uuid not null references platform.projects (id),
  user_id                uuid not null,
  company_id             uuid not null references platform.companies (id),
  permission_template_id uuid not null,
  is_external            boolean not null default false,
  status                 text not null default 'active' check (status in ('active', 'removed')),
  removed_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  updated_by             uuid,
  version                int not null default 1,
  unique (project_id, user_id)
);
create index project_members_project on platform.project_members (org_id, project_id);
create index project_members_user on platform.project_members (user_id);
create index project_members_company on platform.project_members (org_id, company_id);
create index project_members_template on platform.project_members (org_id, permission_template_id);
select kernel.enable_tenant_rls('platform.project_members');

create table platform.invitations (
  id                     uuid primary key,
  org_id                 uuid not null references platform.orgs (id),
  email                  citext not null,
  role                   text check (role in ('admin', 'billing_admin', 'member')),
  project_id             uuid references platform.projects (id),
  company_id             uuid references platform.companies (id),
  permission_template_id uuid,
  token_hash             bytea not null unique,
  expires_at             timestamptz not null,
  accepted_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  updated_by             uuid,
  version                int not null default 1
);
create index invitations_org on platform.invitations (org_id, email);
create index invitations_project on platform.invitations (org_id, project_id);
create index invitations_company on platform.invitations (org_id, company_id);
select kernel.enable_tenant_rls('platform.invitations');

-- Self scope (ADR-0007): read-only access to the caller's own memberships and the orgs they belong to,
-- so GET /v1/me can list orgs without a tenant context. Only active when kernel.withSelfTx sets
-- app.self_user_id, which it does together with a nil app.org_id that matches no tenant row.
create policy self_read on platform.memberships for select
  using (user_id = kernel.self_user_id() and status = 'active');
create policy self_read on platform.project_members for select
  using (user_id = kernel.self_user_id() and status = 'active');
create policy self_read on platform.orgs for select
  using (id in (select org_id from platform.memberships where user_id = kernel.self_user_id() and status = 'active')
      or id in (select org_id from platform.project_members where user_id = kernel.self_user_id() and status = 'active'));

select kernel.grant_module_schema('platform');
