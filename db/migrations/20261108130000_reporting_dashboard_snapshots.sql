-- Composed from modules/reporting/db/migrations/20261108130000_reporting_dashboard_snapshots.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- reporting: dashboard snapshots. A snapshot is the whole portfolio dashboard as its maker saw it at one moment, stored
-- as data (not a rendered page) so it can be reopened exactly as it was and compared with now or another snapshot.
-- Visible to its maker and org owners/admins only, because the stored numbers were narrowed to what the maker could open.

create table reporting.dashboard_snapshots (
  id            uuid primary key,
  org_id        uuid not null,
  title         text not null check (length(title) between 1 and 120),
  current_as_of date not null,
  program       text check (program is null or length(program) between 1 and 80),
  data          jsonb not null,
  created_at    timestamptz not null default now(),
  created_by    uuid not null,
  deleted_at    timestamptz
);
create index dashboard_snapshots_org on reporting.dashboard_snapshots (org_id, current_as_of desc, id desc)
  where deleted_at is null;
select kernel.enable_tenant_rls('reporting.dashboard_snapshots');

select kernel.grant_module_schema('reporting');
