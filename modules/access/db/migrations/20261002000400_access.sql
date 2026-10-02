-- access: permission templates and overrides (backend schema/platform.md §access, Sam 02).
-- item_acl and cache_versions arrive with private items and the Redis permission cache.

create schema if not exists access;

create table access.permission_templates (
  id                   uuid primary key,
  org_id               uuid not null,
  key                  text,
  name                 text not null,
  description          text not null default '',
  is_seeded            boolean not null default false,
  tool_levels          jsonb not null,
  granular             text[] not null default '{}',
  company_scoped_tools text[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  version              int not null default 1,
  deleted_at           timestamptz
);
create index permission_templates_org on access.permission_templates (org_id, name) where deleted_at is null;
create unique index permission_templates_key on access.permission_templates (org_id, key) where key is not null and deleted_at is null;
select kernel.enable_tenant_rls('access.permission_templates');

create table access.project_member_overrides (
  id                uuid primary key,
  org_id            uuid not null,
  project_member_id uuid not null,
  permission_key    text not null,
  effect            text not null check (effect in ('grant', 'deny')),
  granted_by        uuid,
  reason            text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  version           int not null default 1,
  unique (org_id, project_member_id, permission_key)
);
select kernel.enable_tenant_rls('access.project_member_overrides');

select kernel.grant_module_schema('access');
