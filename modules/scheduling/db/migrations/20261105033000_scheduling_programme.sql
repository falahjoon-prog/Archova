-- scheduling: the project programme (product/08 S2/S4/S5): schedules (native or imported from MS Project / P6),
-- activities (tasks and milestones) and dependencies. Lookaheads are computed on read, never stored.

create schema if not exists scheduling;

create table scheduling.schedules (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  name          text not null check (length(name) between 1 and 200),
  source        text not null default 'native' check (source in ('native', 'msp', 'p6')),
  data_date     date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  deleted_at    timestamptz
);
create index schedules_project on scheduling.schedules (org_id, project_id, created_at desc) where deleted_at is null;
select kernel.enable_tenant_rls('scheduling.schedules');

create table scheduling.activities (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  schedule_id   uuid not null references scheduling.schedules (id),
  position      int not null check (position >= 1),
  wbs           text not null default '' check (length(wbs) <= 100),
  name          text not null check (length(name) between 1 and 300),
  kind          text not null default 'task' check (kind in ('task', 'milestone')),
  start_date    date not null,
  finish_date   date not null,
  pct_complete  int not null default 0 check (pct_complete between 0 and 100),
  assignee      text not null default '' check (length(assignee) <= 200),
  external_id   text check (external_id is null or length(external_id) <= 100),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (finish_date >= start_date),
  check (kind <> 'milestone' or finish_date = start_date)
);
create index activities_schedule on scheduling.activities (org_id, schedule_id, position);
select kernel.enable_tenant_rls('scheduling.activities');

create table scheduling.dependencies (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  schedule_id    uuid not null references scheduling.schedules (id),
  predecessor_id uuid not null references scheduling.activities (id) on delete cascade,
  successor_id   uuid not null references scheduling.activities (id) on delete cascade,
  type           text not null default 'FS' check (type in ('FS', 'SS', 'FF', 'SF')),
  lag_days       int not null default 0 check (lag_days between -1000 and 1000),
  created_at     timestamptz not null default now(),
  check (predecessor_id <> successor_id)
);
create unique index dependencies_pair on scheduling.dependencies (predecessor_id, successor_id);
create index dependencies_schedule on scheduling.dependencies (org_id, schedule_id);
select kernel.enable_tenant_rls('scheduling.dependencies');

select kernel.grant_module_schema('scheduling');
