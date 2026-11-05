-- Composed from modules/reporting/db/migrations/20261105061234_reporting_reports.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- reporting: saved report definitions for the report builder. A definition is only a source, filters and columns;
-- rows are always read live through the rfis, defects and submittals modules, so a saved report can never show
-- more than the person running it may open.

create schema if not exists reporting;

create table reporting.reports (
  id          uuid primary key,
  org_id      uuid not null,
  name        text not null check (length(name) between 1 and 120),
  shared      boolean not null default false,
  config      jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid not null,
  updated_by  uuid,
  deleted_at  timestamptz
);
create index reports_org on reporting.reports (org_id, name) where deleted_at is null;
select kernel.enable_tenant_rls('reporting.reports');

select kernel.grant_module_schema('reporting');
