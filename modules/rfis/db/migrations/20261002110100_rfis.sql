-- rfis: requests for information (backend schema/rfis-submittals-correspondence.md §rfis, product/03).

create schema if not exists rfis;

create table rfis.rfis (
  id                       uuid primary key,
  org_id                   uuid not null,
  project_id               uuid not null,
  number                   int,
  subject                  text not null check (length(subject) between 1 and 300),
  question                 jsonb,
  question_text            text not null default '',
  status                   text not null default 'draft'
    check (status in ('draft', 'open', 'answered', 'closed', 'void')),
  is_private               boolean not null default false,
  manager_id               uuid,
  raised_by_company_id     uuid,
  received_from_company_id uuid,
  distribution_user_ids    uuid[] not null default '{}',
  distribution_company_ids uuid[] not null default '{}',
  due_date                 date,
  opened_at                timestamptz,
  answered_at              timestamptz,
  closed_at                timestamptz,
  voided_at                timestamptz,
  void_reason              text,
  cost_impact              text check (cost_impact in ('yes', 'no', 'tbc')),
  cost_estimate            numeric(18,2),
  currency                 char(3) not null default 'AUD',
  schedule_impact_days     int check (schedule_impact_days >= 0),
  delay_days               int check (delay_days >= 0),
  location_id              uuid,
  drawing_revision_id      uuid,
  pin_x                    real check (pin_x between 0 and 1),
  pin_y                    real check (pin_y between 0 and 1),
  spec_section_id          uuid,
  official_response_id     uuid,
  source_ref               text,
  custom                   jsonb not null default '{}',
  search                   tsvector generated always as (
    to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(question_text, ''))) stored,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid,
  updated_by               uuid,
  version                  int not null default 1,
  deleted_at               timestamptz,
  check (status = 'draft' or number is not null),
  check ((pin_x is null) = (pin_y is null)),
  check (pin_x is null or drawing_revision_id is not null)
);
create unique index rfis_number on rfis.rfis (project_id, number) where number is not null;
create unique index rfis_source_ref on rfis.rfis (org_id, project_id, source_ref) where source_ref is not null;
create index rfis_register on rfis.rfis (org_id, project_id, status, due_date) where deleted_at is null;
create index rfis_drawing on rfis.rfis (org_id, drawing_revision_id) where drawing_revision_id is not null;
create index rfis_search on rfis.rfis using gin (search);
select kernel.enable_tenant_rls('rfis.rfis');

create table rfis.assignees (
  id               uuid primary key,
  org_id           uuid not null,
  rfi_id           uuid not null references rfis.rfis (id),
  user_id          uuid not null,
  company_id       uuid,
  is_ball_in_court boolean not null default false,
  responded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (rfi_id, user_id)
);
create index assignees_user on rfis.assignees (org_id, user_id);
select kernel.enable_tenant_rls('rfis.assignees');

create table rfis.responses (
  id               uuid primary key,
  org_id           uuid not null,
  rfi_id           uuid not null references rfis.rfis (id),
  author_id        uuid,
  author_name      text,
  author_email     citext,
  body             jsonb,
  body_text        text not null,
  file_ids         uuid[] not null default '{}',
  is_official      boolean not null default false,
  ai_suggestion_id uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1
);
create index responses_rfi on rfis.responses (org_id, rfi_id, created_at);
create unique index responses_official on rfis.responses (rfi_id) where is_official;
select kernel.enable_tenant_rls('rfis.responses');

select kernel.grant_module_schema('rfis');
