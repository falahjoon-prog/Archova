-- Composed from modules/bim/db/migrations/20261105120000_bim.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- bim: design coordination (phase 5, first slice). Models are the issued model files (IFC, Revit exports, NWD) as the
-- team registers them, one current model per discipline name; coordination issues are the clashes and gaps found in
-- them, pinned to model element GUIDs and optionally linked to the RFI raised to resolve them.

create schema if not exists bim;

create table bim.models (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  name             text not null check (length(name) between 1 and 200),
  discipline       text not null check (discipline in ('architectural', 'structural', 'mechanical', 'electrical', 'hydraulic', 'fire', 'civil', 'other')),
  version_label    text not null default '' check (length(version_label) <= 50),
  file_id          uuid,
  status           text not null default 'current' check (status in ('current', 'superseded')),
  superseded_by_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1
);
create index models_project on bim.models (org_id, project_id, created_at desc);
select kernel.enable_tenant_rls('bim.models');

create table bim.issues (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  number        int not null,
  title         text not null check (length(title) between 1 and 200),
  description   text not null default '' check (length(description) <= 10000),
  status        text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority      text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  assignee_id   uuid,
  due_date      date,
  model_id      uuid references bim.models (id),
  -- IFC GlobalIds of the elements involved, as the team pasted or picked them.
  element_guids text[] not null default '{}' check (cardinality(element_guids) <= 50),
  location      text not null default '' check (length(location) <= 200),
  rfi_id        uuid,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  version       int not null default 1,
  deleted_at    timestamptz
);
create unique index issues_number on bim.issues (project_id, number);
create index issues_register on bim.issues (org_id, project_id, status, created_at desc) where deleted_at is null;
select kernel.enable_tenant_rls('bim.issues');

create table bim.issue_comments (
  id         uuid primary key,
  org_id     uuid not null,
  issue_id   uuid not null references bim.issues (id),
  author_id  uuid not null,
  body       text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index issue_comments_issue on bim.issue_comments (issue_id, created_at);
select kernel.enable_tenant_rls('bim.issue_comments');

select kernel.grant_module_schema('bim');
