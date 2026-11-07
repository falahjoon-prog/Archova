-- Composed from modules/bim/db/migrations/20261107100000_bim_issue_pins.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- bim: a coordination issue can be raised from a point on a drawing. Same pin shape as RFIs and defects (the
-- revision, and x and y as 0..1 sheet coordinates), plus the snapshot of the sheet area the person was looking at.

alter table bim.issues
  add column drawing_revision_id uuid,
  add column sheet_id            uuid,
  add column pin_x               real check (pin_x between 0 and 1),
  add column pin_y               real check (pin_y between 0 and 1),
  add column snapshot_file_id    uuid,
  add check ((pin_x is null) = (pin_y is null)),
  add check (pin_x is null or drawing_revision_id is not null);

create index issues_drawing on bim.issues (org_id, drawing_revision_id)
  where drawing_revision_id is not null and deleted_at is null;
