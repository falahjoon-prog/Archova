-- Composed from modules/platform/db/migrations/20261030020000_platform_member_removal.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- platform (phase 1): removing someone from a project (X38). The kind decides whether their phone may send the work
-- it had queued (ordinary only); the episode counts how many times access was given, so a re-add starts afresh.

alter table platform.project_members add column removal_kind text;
alter table platform.project_members add column removal_reason text;
alter table platform.project_members add column access_episode int not null default 1;
alter table platform.project_members add constraint project_members_removal_kind
  check (removal_kind in ('ordinary', 'for_cause', 'wipe_now'));
-- Not validated against existing rows: no path to 'removed' existed before this migration, so there are none to check,
-- and a backfill would need the tenant context a migration does not have (RLS). New and changed rows are checked.
alter table platform.project_members add constraint project_members_removal_shape
  check ((status = 'removed') = (removal_kind is not null)) not valid;
