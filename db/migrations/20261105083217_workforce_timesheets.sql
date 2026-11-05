-- Composed from modules/workforce/db/migrations/20261105083217_workforce_timesheets.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Daily timesheets per worker (ATT-US9, X54): built from attendance sessions, adjusted with a reason, approved by a
-- supervisor. An approved timesheet is locked; a change needs a rejection first. Hours only: awards and pay stay in
-- payroll.
create table workforce.timesheets (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  worker_id        uuid not null references workforce.workers (id),
  company_id       uuid,
  local_date       date not null,
  status           text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'exported')),
  submitted_at     timestamptz,
  submitted_by     uuid,
  decided_at       timestamptz,
  decided_by       uuid,
  rejection_reason text check (rejection_reason is null or length(rejection_reason) between 1 and 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1
);
create unique index timesheets_one_per_day on workforce.timesheets (org_id, worker_id, project_id, local_date);
create index timesheets_day on workforce.timesheets (org_id, project_id, local_date, company_id);
select kernel.enable_tenant_rls('workforce.timesheets');

create table workforce.timesheet_lines (
  id                    uuid primary key,
  org_id                uuid not null,
  timesheet_id          uuid not null references workforce.timesheets (id),
  project_id            uuid not null,
  minutes               int not null check (minutes between 0 and 1440),
  break_minutes         int not null default 0 check (break_minutes between 0 and 720),
  source                text not null check (source in ('attendance', 'manual', 'adjusted')),
  attendance_session_id uuid references workforce.attendance_sessions (id),
  adjusted_reason       text check (adjusted_reason is null or length(adjusted_reason) between 1 and 500),
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  -- Anything that is not straight from a sign-in says why.
  check (source = 'attendance' or adjusted_reason is not null)
);
create index timesheet_lines_sheet on workforce.timesheet_lines (org_id, timesheet_id);
create unique index timesheet_lines_one_per_session on workforce.timesheet_lines (attendance_session_id)
  where attendance_session_id is not null;
select kernel.enable_tenant_rls('workforce.timesheet_lines');
select kernel.grant_module_schema('workforce');
