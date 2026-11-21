-- Composed from modules/safety/db/migrations/20261120040000_safety_pretask_templates.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- safety: reusable pre-task plan templates. A supervisor saves the hazards and controls a kind of task usually has, and
-- anyone starting a plan can begin from one. Nothing here is a record of work done; plans copy what they need.

create table safety.pretask_templates (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  name        text not null check (length(name) between 1 and 200),
  task_title  text not null check (length(task_title) between 1 and 200),
  swms_id     uuid references safety.swms (id),
  hazards     jsonb not null default '[]',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1
);
create index pretask_templates_project on safety.pretask_templates (org_id, project_id, is_active);
select kernel.enable_tenant_rls('safety.pretask_templates');

select kernel.grant_module_schema('safety');
