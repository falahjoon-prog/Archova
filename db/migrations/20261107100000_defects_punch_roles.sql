-- Composed from modules/defects/db/migrations/20261107100000_defects_punch_roles.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Punch list roles (Procore parity): a Punch Item Manager, a Final Approver, several assignees and a
-- distribution list. `assignee_user_id` stays as the first assignee so existing clients keep working.
alter table defects.defects
  add column manager_user_id        uuid,
  add column final_approver_user_id uuid,
  add column assignee_user_ids      uuid[] not null default '{}',
  add column distribution_user_ids  uuid[] not null default '{}';

-- The backfill spans every org, so it runs with FORCE lifted: the tenant policy reads app.org_id, which a
-- migration never sets. Restored straight after.
alter table defects.defects no force row level security;
update defects.defects set assignee_user_ids = array[assignee_user_id] where assignee_user_id is not null;
alter table defects.defects force row level security;
