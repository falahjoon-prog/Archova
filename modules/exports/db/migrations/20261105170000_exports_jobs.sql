-- exports: one row per full-data-export request (a zip of every record and uploaded file the organisation holds).
-- The archive itself lives in the file store under exports/<org>/<id>.zip for 7 days; this row is the record.

create schema if not exists exports;

create table exports.export_jobs (
  id                 uuid primary key,
  org_id             uuid not null,
  requested_by       uuid not null,
  status             text not null check (status in ('queued', 'running', 'ready', 'failed', 'expired')),
  storage_key        text,
  size_bytes         bigint,
  sha256             char(64),
  table_count        int,
  file_count         int,
  skipped_file_count int,
  error              text,
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  expires_at         timestamptz,
  version            int not null default 1
);
create index export_jobs_org on exports.export_jobs (org_id, created_at desc);
-- One export at a time per organisation, so a double click or a retry cannot start two.
create unique index export_jobs_one_active on exports.export_jobs (org_id) where status in ('queued', 'running');
select kernel.enable_tenant_rls('exports.export_jobs');

select kernel.grant_module_schema('exports');
