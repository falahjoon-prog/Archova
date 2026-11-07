-- Composed from modules/documents/db/migrations/20261107090200_documents_created_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- "New documents this week" filters by creation time.
create index concurrently if not exists documents_created
  on documents.documents (org_id, project_id, created_at desc) where deleted_at is null;
