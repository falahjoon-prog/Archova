-- workforce: daily timesheets per worker built from sign-ins (backend schema/workforce.md "Phase 2", ATT-US9).
-- Pre-filled from attendance; the worker or supervisor adjusts with a reason; an approved timesheet is locked.

create table workforce.timesheets (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  worker_id        uuid not null references workforce.workers (id),
  company_id       uuid,
  local_date       date not null,
  status           text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'exported')),
  submitted_at     timestamptz,
  approved_by      uuid,
  approved_at      timestamptz,
  rejection_reason text check (rejection_reason is null or length(rejection_reason) between 1 and 1000),
  exported_at      timestamptz,
  created_at       timestamptz not null default now(),
  version          int not null default 1,
  unique (org_id, worker_id, project_id, local_date)
);
create index timesheets_project_date on workforce.timesheets (org_id, project_id, local_date);
select kernel.enable_tenant_rls('workforce.timesheets');

create table workforce.timesheet_lines (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  timesheet_id          uuid not null references workforce.timesheets (id),
  minutes               int not null check (minutes between 0 and 1440),
  break_minutes         int not null default 0 check (break_minutes between 0 and 1440),
  cost_code_id          uuid,
  source                text not null check (source in ('attendance', 'manual', 'adjusted')),
  attendance_session_id uuid references workforce.attendance_sessions (id),
  adjusted_reason       text check (adjusted_reason is null or length(adjusted_reason) between 1 and 1000),
  created_at            timestamptz not null default now(),
  created_by            uuid,
  check (break_minutes <= minutes),
  check (source = 'attendance' or adjusted_reason is not null),
  unique (attendance_session_id)
);
create index timesheet_lines_sheet on workforce.timesheet_lines (org_id, timesheet_id);
select kernel.enable_tenant_rls('workforce.timesheet_lines');

select kernel.grant_module_schema('workforce');
