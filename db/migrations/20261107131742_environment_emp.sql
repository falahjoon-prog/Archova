-- Composed from modules/environment/db/migrations/20261107131742_environment_emp.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- environment: the project Environmental Management Plan (EMP), its compliance-condition register with
-- sign-off history, and the environmental document register (permits, licences, plans, audits).

create schema if not exists environment;

-- One plan per project: what the EMP is, which permit it answers to, and when it is next reviewed.
create table environment.plans (
  id                      uuid primary key,
  org_id                  uuid not null,
  project_id              uuid not null,
  title                   text not null check (length(title) between 1 and 200),
  permit_reference        text check (length(permit_reference) <= 200),
  summary                 text check (length(summary) <= 4000),
  status                  text not null default 'draft' check (status in ('draft', 'active')),
  review_interval_months  int not null default 6 check (review_interval_months between 1 and 60),
  next_review_date        date,
  approved_at             timestamptz,
  approved_by             uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  updated_by              uuid,
  version                 int not null default 1
);
create unique index plans_project on environment.plans (project_id);
select kernel.enable_tenant_rls('environment.plans');

-- A compliance condition: one obligation from a permit, licence, the CEMP or the client, with who owns it,
-- how often it is checked, and its current sign-off state.
create table environment.conditions (
  id                       uuid primary key,
  org_id                   uuid not null,
  project_id               uuid not null,
  number                   int not null,
  title                    text not null check (length(title) between 1 and 300),
  requirement              text check (length(requirement) <= 4000),
  category                 text not null check (category in (
    'air_quality', 'noise_vibration', 'water_quality', 'waste', 'soil_erosion',
    'biodiversity', 'heritage', 'hazardous_materials', 'traffic_amenity', 'energy_carbon', 'other')),
  source                   text not null default 'other' check (source in (
    'planning_permit', 'epa_licence', 'cemp', 'council', 'client', 'other')),
  source_reference         text check (length(source_reference) <= 200),
  frequency                text not null default 'once' check (frequency in (
    'once', 'daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'per_event')),
  responsible_company_id   uuid,
  responsible_user_id      uuid,
  status                   text not null default 'not_started' check (status in (
    'not_started', 'in_progress', 'compliant', 'non_compliant', 'not_applicable')),
  due_date                 date,
  last_reviewed_on         date,
  file_ids                 uuid[] not null default '{}',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid,
  updated_by               uuid,
  version                  int not null default 1,
  deleted_at               timestamptz
);
create unique index conditions_number on environment.conditions (project_id, number);
create index conditions_register on environment.conditions (org_id, project_id, status) where deleted_at is null;
select kernel.enable_tenant_rls('environment.conditions');

-- Append-only sign-off trail: every status change with who, when, why and the evidence attached.
create table environment.condition_events (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  condition_id  uuid not null references environment.conditions (id),
  action        text not null check (action in ('start', 'sign_off', 'flag_non_compliant', 'not_applicable', 'reopen')),
  from_status   text not null,
  to_status     text not null,
  note          text check (length(note) <= 4000),
  file_ids      uuid[] not null default '{}',
  actor_id      uuid,
  at            timestamptz not null default now()
);
create index condition_events_condition on environment.condition_events (org_id, condition_id, at);
select kernel.enable_tenant_rls('environment.condition_events');

-- Permits, licences, plans, approval letters and audit reports, each with the file and an expiry date.
create table environment.documents (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  title       text not null check (length(title) between 1 and 300),
  doc_type    text not null check (doc_type in (
    'emp', 'permit', 'epa_licence', 'approval_letter', 'monitoring_plan', 'waste_plan', 'audit_report', 'other')),
  reference   text check (length(reference) <= 200),
  file_id     uuid not null,
  issued_on   date,
  expires_on  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  deleted_at  timestamptz
);
create index documents_register on environment.documents (org_id, project_id, doc_type) where deleted_at is null;
select kernel.enable_tenant_rls('environment.documents');
