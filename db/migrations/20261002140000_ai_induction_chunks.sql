-- Composed from modules/ai/db/migrations/20261002140000_ai_induction_chunks.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Induction Q&A (ai/12 §2 I3). An approved induction version's slides and script are chunked into ai_chunks with
-- `source_type = induction` and `access_scope = induction:<version id>`, so a worker's question can only retrieve
-- that version, and Ask Nova (whose scopes come from `documents`) never retrieves an induction.
-- source_id is the induction id, revision_id the version id, and page the slide number.
alter table ai.ai_chunks drop constraint ai_chunks_source_type_check;
alter table ai.ai_chunks add constraint ai_chunks_source_type_check
  check (source_type in ('document', 'drawing', 'induction'));
alter table ai.ai_index_entries drop constraint ai_index_entries_source_type_check;
alter table ai.ai_index_entries add constraint ai_index_entries_source_type_check
  check (source_type in ('document', 'drawing', 'induction'));
