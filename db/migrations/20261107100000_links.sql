-- Composed from modules/links/db/migrations/20261107100000_links.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- links: related items. One row joins any two records on the same project (RFI, defect, submittal, ...), shown from
-- both ends. The record types are not constrained here so a tool module can join the registry without a migration;
-- the application only accepts types whose owning module can say what the caller may open.

create schema if not exists links;

create table links.links (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  from_type   text not null check (length(from_type) between 1 and 40),
  from_id     uuid not null,
  to_type     text not null check (length(to_type) between 1 and 40),
  to_id       uuid not null,
  reason      text not null check (reason in ('related', 'caused_by', 'blocked_by', 'responds_to', 'duplicate_of', 'supersedes')),
  note        text check (note is null or length(note) between 1 and 300),
  origin      text not null default 'user' check (origin in ('user', 'nova', 'system')),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  check (not (from_type = to_type and from_id = to_id))
);
create unique index links_pair on links.links (project_id, from_type, from_id, to_type, to_id, reason);
create index links_from on links.links (project_id, from_type, from_id);
create index links_to on links.links (project_id, to_type, to_id);
select kernel.enable_tenant_rls('links.links');

select kernel.grant_module_schema('links');
