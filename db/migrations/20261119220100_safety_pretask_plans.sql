-- Composed from modules/safety/db/migrations/20261119220100_safety_pretask_plans.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- safety: pre-task plans (take-5 style). The crew lists the hazards of today's task and the controls they will use,
-- signs on, and the plan is closed as a record. It may link to the SWMS the work falls under. Each crew row keeps the
-- induction status seen when the person signed. Reviewing is the supervisor's step. Every change is logged in an
-- append-only trail.

create table safety.pretask_plans (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  number           int not null,
  task_title       text not null check (length(task_title) between 1 and 200),
  work_date        date not null,
  location         text check (location is null or length(location) <= 200),
  company_id       uuid,
  swms_id          uuid references safety.swms (id),
  supervisor_name  text not null check (length(supervisor_name) between 1 and 200),
  -- [{ hazard, riskBefore, controls, riskAfter }]
  hazards          jsonb not null default '[]',
  status           text not null default 'open' check (status in ('open', 'closed')),
  closed_at        timestamptz,
  closed_by        uuid,
  reviewed_at      timestamptz,
  reviewed_by      uuid,
  review_note      text check (review_note is null or length(review_note) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1,
  deleted_at       timestamptz,
  check ((reviewed_at is null) = (reviewed_by is null))
);
create unique index pretask_plans_number on safety.pretask_plans (project_id, number);
create index pretask_plans_register on safety.pretask_plans (org_id, project_id, work_date desc, id desc) where deleted_at is null;
create index pretask_plans_swms on safety.pretask_plans (org_id, swms_id) where deleted_at is null;
select kernel.enable_tenant_rls('safety.pretask_plans');

create table safety.pretask_crew (
  id                 uuid primary key,
  org_id             uuid not null,
  project_id         uuid not null,
  plan_id            uuid not null references safety.pretask_plans (id),
  person_name        text not null check (length(person_name) between 1 and 200),
  company_id         uuid,
  user_id            uuid,
  signed_at          timestamptz,
  signature_file_id  uuid,
  signed_by          uuid,
  -- induction status seen when the row signed: current, not_inducted, needs_reinduction, expired or unknown
  induction_status   text check (induction_status is null or induction_status in ('current', 'not_inducted', 'needs_reinduction', 'expired', 'unknown')),
  created_at         timestamptz not null default now(),
  created_by         uuid,
  check ((signed_at is null) = (signed_by is null))
);
create index pretask_crew_plan on safety.pretask_crew (org_id, plan_id);
create unique index pretask_crew_person on safety.pretask_crew (plan_id, lower(person_name), coalesce(company_id, '00000000-0000-0000-0000-000000000000'));
select kernel.enable_tenant_rls('safety.pretask_crew');

create table safety.pretask_events (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  plan_id     uuid not null references safety.pretask_plans (id),
  action      text not null,
  note        text,
  actor_id    uuid,
  at          timestamptz not null default now()
);
create index pretask_events_plan on safety.pretask_events (org_id, plan_id, at);
select kernel.enable_tenant_rls('safety.pretask_events');

create function safety.pretask_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'pre-task plan events are append-only' using errcode = 'P0001';
end $$;
create trigger pretask_events_append_only before update or delete on safety.pretask_events
  for each row execute function safety.pretask_events_append_only();

select kernel.grant_module_schema('safety');
