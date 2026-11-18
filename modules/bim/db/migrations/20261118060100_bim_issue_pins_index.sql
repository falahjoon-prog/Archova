-- archova:no-transaction
-- Lookup of the issues raised on a drawing revision.
create index concurrently if not exists issues_drawing on bim.issues (org_id, drawing_revision_id)
  where drawing_revision_id is not null and deleted_at is null;
