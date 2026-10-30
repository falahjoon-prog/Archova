-- Composed from modules/backoffice/db/migrations/20261030090000_flags.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Feature flags, pilot cohorts and the flag change log (backend 09 §5). Global tables for staff: no project
-- content here. Local runs evaluate from these tables; hosted cells render the same rules into AppConfig.

create table backoffice.cohorts (
  id           uuid primary key,
  name         text not null,
  description  text not null default '',
  created_by   uuid references backoffice.staff_users (id),
  created_at   timestamptz not null default now()
);
create unique index cohorts_name on backoffice.cohorts (lower(name));

create table backoffice.cohort_members (
  cohort_id  uuid not null references backoffice.cohorts (id) on delete cascade,
  member_org_id  uuid not null references backoffice.tenant_directory (id),
  added_by   uuid references backoffice.staff_users (id),
  added_at   timestamptz not null default now(),
  primary key (cohort_id, member_org_id)
);
create index cohort_members_org on backoffice.cohort_members (member_org_id);

-- One row per flag that has ever had a rule. The key is checked against the code registry in the application.
create table backoffice.flags (
  key              text primary key,
  enabled_for_all  boolean not null default false,
  percent          int not null default 0 check (percent between 0 and 100),
  updated_by       uuid references backoffice.staff_users (id),
  updated_at       timestamptz not null default now()
);

create table backoffice.flag_targets (
  flag_key    text not null references backoffice.flags (key) on delete cascade,
  kind        text not null check (kind in ('org', 'cohort')),
  ref_id      uuid not null,
  created_by  uuid references backoffice.staff_users (id),
  created_at  timestamptz not null default now(),
  primary key (flag_key, kind, ref_id)
);

create table backoffice.flag_changes (
  id          uuid primary key,
  flag_key    text not null,
  summary     text not null,
  reason      text not null,
  ticket_ref  text,
  staff_id    uuid not null references backoffice.staff_users (id),
  created_at  timestamptz not null default now()
);
create index flag_changes_flag on backoffice.flag_changes (flag_key, created_at desc);

select kernel.grant_module_schema('backoffice');
