-- quality: inspection checklists, inspections and observations (backend schema/quality-safety.md, product roadmap phase 2).

create schema if not exists quality;

-- A template is frozen once published; a change is a new version (inspections point at the version they used).
create table quality.inspection_templates (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  name        text not null check (length(name) between 1 and 200),
  type        text not null default 'ITP' check (length(type) between 1 and 50),
  version     int not null default 1,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz
);
create unique index inspection_templates_version
  on quality.inspection_templates (project_id, lower(name), version) where deleted_at is null;
select kernel.enable_tenant_rls('quality.inspection_templates');

create table quality.inspection_template_items (
  id                      uuid primary key,
  org_id                  uuid not null,
  template_id             uuid not null references quality.inspection_templates (id),
  section                 text not null default '',
  sort                    int not null,
  prompt                  text not null check (length(prompt) between 1 and 1000),
  response_type           text not null
    check (response_type in ('pass_fail_na', 'yes_no', 'number', 'text', 'photo', 'signature', 'select')),
  options                 jsonb not null default '[]',
  required                boolean not null default true,
  creates_defect_on_fail  boolean not null default false
);
create index inspection_template_items_template on quality.inspection_template_items (org_id, template_id, sort);
select kernel.enable_tenant_rls('quality.inspection_template_items');

create table quality.inspections (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  template_id       uuid not null references quality.inspection_templates (id),
  template_version  int not null,
  number            int not null,
  title             text not null check (length(title) between 1 and 300),
  location          text,
  status            text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'submitted', 'closed')),
  inspector_id      uuid,
  scheduled_for     date,
  completed_at      timestamptz,
  signed_by         jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  version           int not null default 1,
  deleted_at        timestamptz
);
create unique index inspections_number on quality.inspections (project_id, number);
create index inspections_register on quality.inspections (org_id, project_id, status) where deleted_at is null;
select kernel.enable_tenant_rls('quality.inspections');

create table quality.inspection_responses (
  id                uuid primary key,
  org_id            uuid not null,
  inspection_id     uuid not null references quality.inspections (id),
  template_item_id  uuid not null references quality.inspection_template_items (id),
  value             jsonb,
  result            text check (result in ('pass', 'fail', 'na')),
  note              text,
  file_ids          uuid[] not null default '{}',
  defect_id         uuid,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  unique (inspection_id, template_item_id)
);
select kernel.enable_tenant_rls('quality.inspection_responses');

create table quality.observations (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  number                int not null,
  type                  text not null check (type in ('safety', 'quality', 'environmental', 'commercial')),
  hazard                text,
  description           text not null check (length(description) between 1 and 20000),
  location              text,
  priority              text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  assignee_company_id   uuid,
  raised_by_company_id  uuid,
  status                text not null default 'open' check (status in ('open', 'resolved', 'closed')),
  due_date              date,
  swms_id               uuid,
  resolution_note       text,
  file_ids              uuid[] not null default '{}',
  resolved_at           timestamptz,
  closed_at             timestamptz,
  closed_by             uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  version               int not null default 1,
  deleted_at            timestamptz
);
create unique index observations_number on quality.observations (project_id, number);
create index observations_register on quality.observations (org_id, project_id, status, assignee_company_id)
  where deleted_at is null;
select kernel.enable_tenant_rls('quality.observations');

select kernel.grant_module_schema('quality');
