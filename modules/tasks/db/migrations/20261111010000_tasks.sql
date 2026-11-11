-- tasks: ad-hoc project tasks. Action items that already live in meetings and safety are not copied here; the
-- "my tasks" rollup reads them where they are, so closing one still happens in its own module.

create schema if not exists tasks;

create table tasks.tasks (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  number            int not null,
  title             text not null check (length(title) between 1 and 200),
  description       text check (description is null or length(description) <= 5000),
  assignee_user_id  uuid,
  due_date          date,
  priority          text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status            text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  completed_at      timestamptz,
  completed_by      uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid not null,
  updated_by        uuid,
  version           int not null default 1,
  deleted_at        timestamptz
);
create unique index tasks_number on tasks.tasks (project_id, number);
create index tasks_project_register on tasks.tasks (org_id, project_id, status, due_date)
  where deleted_at is null;
-- "My tasks": open tasks by assignee across the organisation.
create index tasks_mine on tasks.tasks (org_id, assignee_user_id, due_date)
  where deleted_at is null and status = 'open';
select kernel.enable_tenant_rls('tasks.tasks');

select kernel.grant_module_schema('tasks');
