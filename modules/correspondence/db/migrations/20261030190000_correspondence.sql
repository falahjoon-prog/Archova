-- correspondence: configurable notice and letter types with AU templates, and the items sent under them
-- (backend schema/rfis-submittals-correspondence.md §correspondence, product/08 SCH-AC5, product/03).

create schema if not exists correspondence;

create table correspondence.types (
  id                uuid primary key,
  org_id            uuid not null,
  name              text not null check (length(name) between 1 and 80),
  prefix            text not null check (prefix ~ '^[A-Z]{1,6}$'),
  description       text not null default '' check (length(description) <= 500),
  template_key      text,
  is_evidential     bool not null default false,
  response_required bool not null default false,
  response_days     int not null default 10 check (response_days between 0 and 250),
  time_bar_days     int check (time_bar_days between 1 and 365),
  subject_template  text not null default '' check (length(subject_template) <= 300),
  body_template     text not null default '' check (length(body_template) <= 20000),
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  version           int not null default 1
);
create unique index types_prefix on correspondence.types (org_id, prefix) where archived_at is null;
select kernel.enable_tenant_rls('correspondence.types');

create table correspondence.items (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  type_id           uuid not null references correspondence.types (id),
  type_name         text not null,
  is_evidential     bool not null,
  number            int not null,
  number_label      text not null,
  subject           text not null default '' check (length(subject) <= 300),
  body              text not null default '' check (length(body) <= 50000),
  status            text not null default 'draft'
    check (status in ('draft', 'sent', 'responded', 'closed', 'void')),
  from_company_id   uuid,
  to_company_ids    uuid[] not null default '{}',
  response_required bool not null default false,
  due_date          date,
  event_date        date,
  time_bar_days     int,
  time_bar_date     date,
  file_ids          uuid[] not null default '{}',
  related           jsonb not null default '[]',
  sent_at           timestamptz,
  sent_by           uuid,
  content_hash      text,
  closed_at         timestamptz,
  void_reason       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  version           int not null default 1,
  deleted_at        timestamptz
);
create unique index items_label on correspondence.items (project_id, number_label);
create unique index items_number on correspondence.items (project_id, type_id, number);
create index items_register on correspondence.items (org_id, project_id, status, due_date) where deleted_at is null;
select kernel.enable_tenant_rls('correspondence.items');

create table correspondence.responses (
  id                uuid primary key,
  org_id            uuid not null,
  item_id           uuid not null references correspondence.items (id),
  author_id         uuid not null,
  author_company_id uuid,
  body              text not null check (length(body) between 1 and 50000),
  file_ids          uuid[] not null default '{}',
  sent_at           timestamptz not null default now()
);
create index responses_item on correspondence.responses (item_id, sent_at);
select kernel.enable_tenant_rls('correspondence.responses');

select kernel.grant_module_schema('correspondence');
