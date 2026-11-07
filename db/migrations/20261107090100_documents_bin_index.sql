-- Composed from modules/documents/db/migrations/20261107090100_documents_bin_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- The recycle bin lists by deletion time.
create index concurrently if not exists documents_bin
  on documents.documents (org_id, project_id, deleted_at desc) where deleted_at is not null;
