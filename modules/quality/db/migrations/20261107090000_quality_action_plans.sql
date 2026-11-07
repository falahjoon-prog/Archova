-- quality: action plans (a numbered checklist of steps with assignees and due dates, optionally raised from an
-- observation or inspection) and the templates a project reuses to start the same plan again.

create table quality.action_plan_templates (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  name        text not null check (length(name) between 1 and 200),
  description text not null default '' check (length(description) <= 5000),
  -- [{ title, description, dueOffsetDays }] in step order.
  items       jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  deleted_at  timestamptz
);
create index action_plan_templates_project on quality.action_plan_templates (org_id, project_id) where deleted_at is null;
select kernel.enable_tenant_rls('quality.action_plan_templates');

create table quality.action_plans (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  number       int not null,
  title        text not null check (length(title) between 1 and 200),
  description  text not null default '' check (length(description) <= 5000),
  status       text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  due_date     date,
  template_id  uuid references quality.action_plan_templates (id),
  source_type  text check (source_type in ('observation', 'inspection')),
  source_id    uuid,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  version      int not null default 1,
  deleted_at   timestamptz,
  check ((source_type is null) = (source_id is null))
);
create unique index action_plans_number on quality.action_plans (project_id, number);
create index action_plans_register on quality.action_plans (org_id, project_id, status) where deleted_at is null;
create index action_plans_source on quality.action_plans (org_id, source_type, source_id) where deleted_at is null;
select kernel.enable_tenant_rls('quality.action_plans');

create table quality.action_plan_items (
  id                  uuid primary key,
  org_id              uuid not null,
  plan_id             uuid not null references quality.action_plans (id),
  sort                int not null,
  title               text not null check (length(title) between 1 and 300),
  description         text not null default '' check (length(description) <= 5000),
  assignee_company_id uuid,
  due_date            date,
  status              text not null default 'open' check (status in ('open', 'done', 'skipped')),
  note                text,
  completed_at        timestamptz,
  completed_by        uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid
);
create index action_plan_items_plan on quality.action_plan_items (plan_id, sort);
create index action_plan_items_assignee on quality.action_plan_items (org_id, assignee_company_id) where assignee_company_id is not null;
select kernel.enable_tenant_rls('quality.action_plan_items');

select kernel.grant_module_schema('quality');
