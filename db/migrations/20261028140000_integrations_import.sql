-- Composed from modules/integrations/db/migrations/20261028140000_integrations_import.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- integrations (phase 1): import staging (integrations/07 §1). A job reads one customer export file into
-- staged rows, a person maps the columns and checks the dry run, and a later step applies it through the
-- owning module's import command. Staging rows are deleted 30 days after the job finishes (worker).

create schema if not exists integrations;

create table integrations.import_jobs (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  -- what the rows become: rfi | defect | drawing_register | company
  entity        text not null check (entity in ('rfi', 'defect', 'drawing_register', 'company')),
  source        text not null default 'spreadsheet'
    check (source in ('spreadsheet', 'aconex_export', 'procore_export')),
  file_id       uuid not null,
  status        text not null default 'uploaded'
    check (status in ('uploaded', 'parsed', 'mapped', 'validated', 'applying', 'done', 'failed', 'rolled_back', 'cancelled')),
  header_row    int not null default 1 check (header_row between 1 and 100),
  -- column headings read from the header row
  headers       jsonb not null default '[]',
  -- { columns: { "<field>": <column index> }, values: { "<field>": { "<source value>": "<archova value>" } } }
  mapping       jsonb not null default '{"columns": {}, "values": {}}',
  total_rows    int not null default 0,
  valid_rows    int not null default 0,
  invalid_rows  int not null default 0,
  started_by    uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz,
  version       int not null default 1
);
-- one import at a time per project (integrations/07 §6)
create unique index import_jobs_one_open_per_project on integrations.import_jobs (project_id)
  where status in ('uploaded', 'parsed', 'mapped', 'validated', 'applying');
create index import_jobs_project on integrations.import_jobs (org_id, project_id, created_at desc);
select kernel.enable_tenant_rls('integrations.import_jobs');

create table integrations.import_rows (
  id                 uuid primary key,
  org_id             uuid not null,
  job_id             uuid not null references integrations.import_jobs (id),
  row_number         int not null check (row_number >= 1),
  -- the row's cells exactly as the file had them
  raw                jsonb not null,
  -- the row in Archova's fields once mapped; null until then
  normalised         jsonb,
  -- the record's own number in the old system; unique per job among valid rows (idempotent re-runs)
  source_ref         text,
  status             text not null default 'staged'
    check (status in ('staged', 'valid', 'invalid', 'skipped', 'applied', 'failed')),
  errors             jsonb not null default '[]',
  created_entity_id  uuid,
  unique (job_id, row_number)
);
create index import_rows_by_job on integrations.import_rows (org_id, job_id, status, row_number);
select kernel.enable_tenant_rls('integrations.import_rows');

select kernel.grant_module_schema('integrations');
