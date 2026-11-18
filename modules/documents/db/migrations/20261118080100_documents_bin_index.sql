-- archova:no-transaction
-- The recycle bin lists by deletion time.
create index concurrently if not exists documents_bin
  on documents.documents (org_id, project_id, deleted_at desc) where deleted_at is not null;
