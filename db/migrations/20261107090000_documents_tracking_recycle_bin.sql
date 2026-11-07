-- Composed from modules/documents/db/migrations/20261107090000_documents_tracking_recycle_bin.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- documents: tracked documents ("Items You Are Tracking") and who moved a document to the recycle bin.
-- `deleted_at` already exists; the bin lists documents where it is set, restore clears it.

alter table documents.documents add column deleted_by uuid;

-- A person's own watch list. Only the person sees their rows, so there is no version or change feed.
create table documents.document_tracking (
  org_id      uuid not null,
  project_id  uuid not null,
  document_id uuid not null references documents.documents (id),
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  primary key (document_id, user_id)
);
create index document_tracking_user on documents.document_tracking (org_id, project_id, user_id);
select kernel.enable_tenant_rls('documents.document_tracking');
select kernel.grant_module_schema('documents');
