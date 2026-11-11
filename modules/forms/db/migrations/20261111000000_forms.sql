-- forms: fill-in forms (job hazard analysis, toolbox talks, permits) from built-in or organisation-built templates.
-- Built-in templates live in code. A form copies its template's fields when it starts, so template edits never
-- change a form already started. Signatures are one row each, with a server time.

create schema if not exists forms;

create table forms.templates (
  id           uuid primary key,
  org_id       uuid not null,
  name         text not null check (length(name) between 1 and 200),
  description  text not null default '' check (length(description) <= 1000),
  category     text not null default 'general' check (category in ('safety', 'quality', 'site', 'admin', 'general')),
  fields       jsonb not null default '[]',
  link_module  text check (link_module in ('diary', 'incidents', 'inspections', 'attendance')),
  cadence_days int check (cadence_days between 1 and 365),
  copied_from  text,
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  version      int not null default 1
);
create unique index templates_active_name on forms.templates (org_id, lower(name)) where status = 'active';
select kernel.enable_tenant_rls('forms.templates');

create table forms.forms (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  number        int not null,
  template_ref  text not null,
  template_name text not null,
  category      text not null check (category in ('safety', 'quality', 'site', 'admin', 'general')),
  link_module   text check (link_module in ('diary', 'incidents', 'inspections', 'attendance')),
  fields        jsonb not null,
  title         text not null check (length(title) between 1 and 200),
  answers       jsonb not null default '{}',
  status        text not null default 'draft' check (status in ('draft', 'submitted')),
  form_date     text not null,
  submitted_at  timestamptz,
  submitted_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid not null,
  updated_by    uuid,
  version       int not null default 1,
  check ((status = 'submitted') = (submitted_at is not null))
);
create unique index forms_number on forms.forms (project_id, number);
create index forms_recent on forms.forms (project_id, created_at desc, id desc);
create index forms_template on forms.forms (project_id, template_ref, status, form_date desc);
select kernel.enable_tenant_rls('forms.forms');

create table forms.signatures (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  form_id         uuid not null references forms.forms (id),
  field_key       text not null,
  signer_name     text not null check (length(signer_name) between 1 and 200),
  signer_key      text not null,
  signer_user_id  uuid,
  signed_at       timestamptz not null default now(),
  unique (form_id, field_key, signer_key)
);
create index signatures_form on forms.signatures (org_id, form_id, signed_at);
select kernel.enable_tenant_rls('forms.signatures');

select kernel.grant_module_schema('forms');
