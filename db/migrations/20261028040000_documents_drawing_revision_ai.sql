-- Composed from modules/documents/db/migrations/20261028040000_documents_drawing_revision_ai.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- The Nova suggestion a draft sheet was added from (ai F-register, DOC-AC1); null for sheets added by hand.
alter table documents.drawing_revisions add column ai_suggestion_id uuid;
