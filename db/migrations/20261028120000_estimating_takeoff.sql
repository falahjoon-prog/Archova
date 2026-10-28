-- Composed from modules/estimating/db/migrations/20261028120000_estimating_takeoff.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- estimating (phase 1): takeoff measurements on drawing revisions (X30, product/10 EST-US7).
-- Sheet geometry and scale live in `documents`; a measurement only keeps the revision id and its own shape.

create table estimating.takeoff_measurements (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  -- documents.drawing_revisions, id only (no cross-module FK)
  revision_id   uuid not null,
  label         text not null check (length(label) between 1 and 200),
  kind          text not null check (kind in ('length', 'area', 'count')),
  -- { type: 'polyline' | 'polygon' | 'points', points: [[x, y], ...] } in sheet units
  geometry      jsonb not null,
  quantity      numeric(18,3) not null check (quantity >= 0),
  unit          text not null check (length(unit) between 1 and 20),
  source        text not null default 'manual' check (source in ('manual', 'assisted', 'auto')),
  confidence    real check (confidence between 0 and 1),
  -- optional link to a tender package scope line this quantity feeds
  package_id    uuid references estimating.tender_packages (id),
  scope_key     text,
  confirmed_by  uuid,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  version       int not null default 1,
  deleted_at    timestamptz,
  check ((confirmed_by is null) = (confirmed_at is null)),
  check (scope_key is null or package_id is not null)
);
create index takeoff_by_revision on estimating.takeoff_measurements (org_id, project_id, revision_id)
  where deleted_at is null;
create index takeoff_by_package on estimating.takeoff_measurements (org_id, package_id)
  where deleted_at is null and package_id is not null;
select kernel.enable_tenant_rls('estimating.takeoff_measurements');

select kernel.grant_module_schema('estimating');
