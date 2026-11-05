-- workforce: shifts and crew rosters (backend schema/workforce.md "Phase 2: rosters and timesheets", ATT-US11).
-- A shift is a block of time at a site for a trade or crew; workers are assigned to it and answer offer/accept.
-- Draft shifts are private to the site manager; publishing offers them to the assigned workers.

create table workforce.shifts (
  id                 uuid primary key,
  org_id             uuid not null,
  project_id         uuid not null,
  site_id            uuid not null references workforce.sites (id),
  crew               text check (crew is null or length(crew) between 1 and 100),
  trade              text not null check (length(trade) between 1 and 100),
  note               text check (note is null or length(note) <= 2000),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  required_headcount int not null check (required_headcount between 1 and 500),
  status             text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  version            int not null default 1,
  check (ends_at > starts_at),
  check ((status = 'draft') = (published_at is null) or status = 'cancelled')
);
create index shifts_project on workforce.shifts (org_id, project_id, starts_at);
select kernel.enable_tenant_rls('workforce.shifts');

create table workforce.shift_assignments (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  shift_id      uuid not null references workforce.shifts (id),
  worker_id     uuid not null references workforce.workers (id),
  company_id    uuid,
  status        text not null default 'offered' check (status in ('offered', 'accepted', 'declined', 'no_show', 'attended')),
  notified_at   timestamptz,
  responded_at  timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  unique (shift_id, worker_id)
);
create index shift_assignments_worker on workforce.shift_assignments (org_id, worker_id);
select kernel.enable_tenant_rls('workforce.shift_assignments');

select kernel.grant_module_schema('workforce');
