-- Composed from modules/forms/db/migrations/20261107110000_forms.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- forms: admin-built form templates (sections, typed fields, required fields) and the submissions people fill in.
-- A published template is frozen; a change is a new version, and a submission keeps the version it was started on.

create schema if not exists forms;

create table forms.templates (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  name        text not null check (length(name) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  category    text check (category is null or length(category) <= 60),
  version     int not null default 1,
  status      text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  fields      jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid not null,
  updated_by  uuid not null,
  deleted_at  timestamptz
);
create unique index templates_version on forms.templates (project_id, lower(name), version) where deleted_at is null;
select kernel.enable_tenant_rls('forms.templates');

create table forms.submissions (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  template_id      uuid not null references forms.templates (id),
  template_version int not null,
  number           int not null,
  title            text not null check (length(title) between 1 and 200),
  status           text not null default 'assigned' check (status in ('assigned', 'in_progress', 'submitted', 'closed')),
  assignee_id      uuid,
  due_date         date,
  answers          jsonb not null default '{}',
  file_ids         uuid[] not null default '{}',
  related_type     text check (related_type is null or related_type in ('incident')),
  related_id       uuid,
  version          int not null default 1,
  created_at       timestamptz not null default now(),
  created_by       uuid not null,
  updated_at       timestamptz not null default now(),
  submitted_at     timestamptz,
  submitted_by     uuid,
  closed_at        timestamptz,
  closed_by        uuid
);
create unique index submissions_number on forms.submissions (project_id, number);
create index submissions_project on forms.submissions (project_id, status, due_date);
create index submissions_assignee on forms.submissions (project_id, assignee_id);
select kernel.enable_tenant_rls('forms.submissions');

select kernel.grant_module_schema('forms');
