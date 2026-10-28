-- Composed from modules/ai/db/migrations/20261028141000_ai_chunks_rfi.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Ask Nova answers from RFIs too (ai/01 F2, ai/03 §3). A sent RFI's question and responses are chunked into
-- ai_chunks with `source_type = rfi` and `access_scope = rfis` (builder staff only for now). source_id is the RFI id
-- and revision_id a hash of its text, so an edit or a new response indexes as a new revision and the old chunks drop.
alter table ai.ai_chunks drop constraint ai_chunks_source_type_check;
alter table ai.ai_chunks add constraint ai_chunks_source_type_check
  check (source_type in ('document', 'drawing', 'induction', 'rfi'));
alter table ai.ai_index_entries drop constraint ai_index_entries_source_type_check;
alter table ai.ai_index_entries add constraint ai_index_entries_source_type_check
  check (source_type in ('document', 'drawing', 'induction', 'rfi'));
