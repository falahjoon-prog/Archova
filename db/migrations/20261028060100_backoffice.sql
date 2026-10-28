-- Composed from modules/backoffice/db/migrations/20261028060100_backoffice.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- backoffice: staff accounts, sessions, roles, the approval queue / admin action log, and the tenant directory
-- (backend 09 §2-3). Global tables: staff are not members of any org and nothing here carries project content.

create schema if not exists backoffice;

create table backoffice.staff_users (
  id             uuid primary key,
  email          citext not null unique,
  name           text not null,
  -- Local sign-in only (local runs and the demo cell). Hosted staff sign in through the staff IdP (idp_subject).
  password_hash  text,
  idp_subject    text unique,
  status         text not null default 'active' check (status in ('active', 'disabled')),
  created_at     timestamptz not null default now(),
  disabled_at    timestamptz
);

create table backoffice.staff_role_assignments (
  id             uuid primary key,
  staff_user_id  uuid not null references backoffice.staff_users (id),
  role           text not null check (role in
    ('owner', 'pricing_approver', 'billing_ops', 'sales', 'support', 'security_lead', 'finance_read')),
  granted_by     uuid,
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz
);
create unique index staff_roles_active on backoffice.staff_role_assignments (staff_user_id, role)
  where revoked_at is null;

create table backoffice.staff_sessions (
  id             uuid primary key,
  staff_user_id  uuid not null references backoffice.staff_users (id),
  token_hash     bytea not null unique,
  auth_time      timestamptz not null,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  ip             inet,
  user_agent     text
);
create index staff_sessions_user on backoffice.staff_sessions (staff_user_id);

-- The approval queue and the admin action log in one table (backend 09 §3).
create table backoffice.requests (
  id                uuid primary key,
  kind              text not null check (kind in ('pricebook.publish', 'plan.publish')),
  target_org_id     uuid,
  subject_ref       text not null,
  subject_label     text not null,
  payload           jsonb not null default '{}',
  preview           jsonb,
  reason            text not null,
  requested_by      uuid not null references backoffice.staff_users (id),
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'cancelled')),
  decision_reason   text,
  approved_by       uuid references backoffice.staff_users (id),
  decided_at        timestamptz,
  solo_owner_mode   boolean not null default false,
  cooling_off_until timestamptz,
  executed_at       timestamptz,
  result            jsonb,
  created_at        timestamptz not null default now(),
  -- No self-approval, except solo-owner mode while one person is the only Owner (Sam 12 §4).
  check (approved_by is null or approved_by <> requested_by or solo_owner_mode)
);
create index requests_status on backoffice.requests (status, created_at desc);
create index requests_org on backoffice.requests (target_org_id, created_at desc) where target_org_id is not null;

-- Customer companies for the console list: kept up to date by platform and billing events so the console
-- never runs a cross-org query on tenant tables (backend 09 §3).
create table backoffice.tenant_directory (
  -- The org's id. Named `id` so the table is not mistaken for a tenant table (it has no RLS).
  id             uuid primary key,
  name           text not null,
  slug           text not null,
  plan_code      text not null,
  state          text not null,
  seats          int,
  trial_ends_at  timestamptz,
  cell           text not null default 'local',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index tenant_directory_name on backoffice.tenant_directory (lower(name));

select kernel.grant_module_schema('backoffice');
