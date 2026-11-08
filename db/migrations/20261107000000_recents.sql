-- Composed from modules/recents/db/migrations/20261107000000_recents.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- recents: the records a person opened lately, per project, for the "Recents" card on the project home. Private to
-- the person. The target is a polymorphic reference (`entity_type` + `entity_id`) with no foreign key, because the
-- record lives in another module; `title` and `subtitle` are what the person saw. Viewing a record again moves it
-- back to the top (`viewed_at`). The service keeps at most 50 rows per person.

create schema if not exists recents;

create table recents.recent_views (
  id          uuid primary key,
  org_id      uuid not null,
  user_id     uuid not null,
  project_id  uuid not null,
  entity_type text not null check (entity_type in ('rfi', 'submittal', 'defect', 'drawing_sheet', 'meeting')),
  entity_id   uuid not null,
  title       text not null check (length(title) between 1 and 200),
  subtitle    text not null default '' check (length(subtitle) <= 200),
  viewed_at   timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);
create index recent_views_by_user on recents.recent_views (org_id, user_id, project_id, viewed_at desc);
select kernel.enable_tenant_rls('recents.recent_views');

select kernel.grant_module_schema('recents');
