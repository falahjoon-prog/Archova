-- platform: the project location tree (site > building > level > zone > room, any depth up to 8). Defects, RFIs,
-- inspections, observations and diary lines point at a row here instead of carrying free text.
-- Rows are archived, never deleted, so old records keep a readable place.

create table platform.project_location_tree (
  id           uuid primary key,
  org_id       uuid not null references platform.orgs (id),
  project_id   uuid not null references platform.projects (id),
  parent_id    uuid references platform.project_location_tree (id),
  kind         text not null default 'area'
               check (kind in ('site', 'building', 'wing', 'level', 'zone', 'room', 'area', 'external')),
  name         text not null check (char_length(btrim(name)) between 1 and 120),
  code         text check (code is null or char_length(code) between 1 and 30),
  sort         int not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  version      int not null default 1,
  check (parent_id is null or parent_id <> id)
);
-- Two live siblings may not share a name (case-insensitive); roots share the all-zero parent.
create unique index project_location_tree_sibling_name
  on platform.project_location_tree (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  where archived_at is null;
create index project_location_tree_project on platform.project_location_tree (org_id, project_id, parent_id, sort);
select kernel.enable_tenant_rls('platform.project_location_tree');

select kernel.grant_module_schema('platform');
