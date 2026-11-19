-- Composed from modules/prefab/db/migrations/20261120090000_prefab_factories.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- prefab: a project keeps its own list of factories (`factories`) so units pick one instead of retyping the name. A unit
-- still stores the factory name as text, so renaming or removing a factory never changes a unit's history.

create table prefab.factories (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  name        text not null check (length(name) between 1 and 200),
  location    text check (location is null or length(location) <= 200),
  contact     text check (contact is null or length(contact) <= 200),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (project_id, name)
);
create index factories_by_project on prefab.factories (org_id, project_id, name);
select kernel.enable_tenant_rls('prefab.factories');

select kernel.grant_module_schema('prefab');
