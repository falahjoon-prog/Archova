-- bookmarks: a person's saved shortcuts to records (RFIs, drawings, submittals, ...). Private to the person who
-- saved them. The target is a polymorphic reference (`entity_type` + `entity_id`) with no foreign key, because the
-- record lives in another module; `title` and `subtitle` are what the person saw when they saved it.

create schema if not exists bookmarks;

create table bookmarks.bookmarks (
  id          uuid primary key,
  org_id      uuid not null,
  user_id     uuid not null,
  project_id  uuid not null,
  entity_type text not null check (entity_type in ('rfi', 'submittal', 'defect', 'drawing_sheet', 'meeting')),
  entity_id   uuid not null,
  title       text not null check (length(title) between 1 and 200),
  subtitle    text not null default '' check (length(subtitle) <= 200),
  created_at  timestamptz not null default now(),
  unique (user_id, entity_type, entity_id)
);
create index bookmarks_by_user on bookmarks.bookmarks (org_id, user_id, created_at desc);
select kernel.enable_tenant_rls('bookmarks.bookmarks');

select kernel.grant_module_schema('bookmarks');
