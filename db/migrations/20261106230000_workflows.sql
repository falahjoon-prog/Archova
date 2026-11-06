-- Composed from modules/workflows/db/migrations/20261106230000_workflows.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- workflows: configurable approval chains. An organisation defines ordered steps for a kind of record (first: variations);
-- a run is one record going through a chain, with the steps frozen at the moment it started.

create schema if not exists workflows;

create table workflows.definitions (
  id           uuid primary key,
  org_id       uuid not null,
  subject_type text not null check (subject_type in ('financials.variation')),
  name         text not null check (length(name) between 1 and 100),
  -- Decimal dollars; the chain applies from this amount up. Null means every record of the kind.
  min_amount   numeric(18, 2) check (min_amount is null or min_amount >= 0),
  -- [{ name, approverUserIds: [uuid] }], 1..8 steps, run in order; any one named approver clears a step.
  steps        jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 8),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  deleted_at   timestamptz
);
create index definitions_org on workflows.definitions (org_id, subject_type) where deleted_at is null;
-- One active workflow per kind of record, so a submission never matches two chains.
create unique index definitions_one_active on workflows.definitions (org_id, subject_type)
  where active and deleted_at is null;
select kernel.enable_tenant_rls('workflows.definitions');

create table workflows.runs (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  definition_id uuid not null references workflows.definitions (id),
  subject_type  text not null,
  subject_id    uuid not null,
  -- The steps as they were when the run started; later edits to the definition do not touch a run in flight.
  steps         jsonb not null,
  current_step  int,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  started_by    uuid not null,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index runs_subject on workflows.runs (org_id, subject_type, subject_id, created_at desc);
create unique index runs_one_pending on workflows.runs (org_id, subject_type, subject_id) where status = 'pending';
select kernel.enable_tenant_rls('workflows.runs');

create table workflows.run_decisions (
  id         uuid primary key,
  org_id     uuid not null,
  run_id     uuid not null references workflows.runs (id),
  step_index int not null,
  user_id    uuid not null,
  decision   text not null check (decision in ('approved', 'rejected')),
  note       text,
  decided_at timestamptz not null default now()
);
create unique index run_decisions_step on workflows.run_decisions (run_id, step_index);
select kernel.enable_tenant_rls('workflows.run_decisions');

select kernel.grant_module_schema('workflows');
