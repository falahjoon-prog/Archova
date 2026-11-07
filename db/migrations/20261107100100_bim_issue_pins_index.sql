-- Composed from modules/bim/db/migrations/20261107100100_bim_issue_pins_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- Lookup of the issues raised on a drawing revision.
create index concurrently if not exists issues_drawing on bim.issues (org_id, drawing_revision_id)
  where drawing_revision_id is not null and deleted_at is null;
