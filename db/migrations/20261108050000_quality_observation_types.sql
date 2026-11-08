-- Composed from modules/quality/db/migrations/20261108050000_quality_observation_types.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- quality: observation types. A built-in catalogue lives in code; this table holds an organisation's or project's custom types and its overrides of the built-in ones (hide a type, require an attachment).

create table quality.observation_types (
  id                   uuid primary key,
  org_id               uuid not null,
  -- Null applies to the whole organisation.
  project_id           uuid,
  -- Set for an override of a built-in type; null for a custom type.
  key                  text,
  group_name           text,
  name                 text check (name is null or length(name) between 1 and 100),
  category             text check (category is null or category in ('safety', 'quality', 'environmental', 'commercial')),
  requires_attachment  boolean,
  hidden               boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  version              int not null default 1,
  deleted_at           timestamptz,
  constraint observation_types_kind check (
    (key is not null and name is null) or (key is null and name is not null and category is not null)
  )
);
create unique index observation_types_override
  on quality.observation_types (org_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  where key is not null and deleted_at is null;
create unique index observation_types_custom_name
  on quality.observation_types (org_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where key is null and deleted_at is null;
select kernel.enable_tenant_rls('quality.observation_types');

-- The type an observation was raised under (a built-in key or custom:<id>); `type` stays its register category.
alter table quality.observations add column type_key text;

select kernel.grant_module_schema('quality');
