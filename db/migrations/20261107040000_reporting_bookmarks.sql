-- Composed from modules/reporting/db/migrations/20261107040000_reporting_bookmarks.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- reporting: a person's saved bookmarks for the "My Work" page. Private to the person who made them (user_id);
-- a bookmark is only a label and an in-app path, so opening it still goes through the normal permission checks.

create table reporting.bookmarks (
  id          uuid primary key,
  org_id      uuid not null,
  user_id     uuid not null,
  project_id  uuid,
  label       text not null check (length(label) between 1 and 120),
  path        text not null check (length(path) between 1 and 300 and path like '/%' and path not like '//%'),
  created_at  timestamptz not null default now()
);
create unique index bookmarks_user_path on reporting.bookmarks (org_id, user_id, path);
create index bookmarks_user on reporting.bookmarks (org_id, user_id, created_at desc);
select kernel.enable_tenant_rls('reporting.bookmarks');

select kernel.grant_module_schema('reporting');
