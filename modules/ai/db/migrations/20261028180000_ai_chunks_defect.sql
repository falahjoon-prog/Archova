-- Ask Nova answers from defects too (ai/01 F2, ai/03 §3). An issued defect's description and the notes on its history
-- are chunked into ai_chunks with `source_type = defect` and `access_scope = defects` (builder staff only for now).
-- source_id is the defect id and revision_id a hash of its text, so a status change, a reassignment or a new note
-- indexes as a new revision and the old chunks drop.
alter table ai.ai_chunks drop constraint ai_chunks_source_type_check;
alter table ai.ai_chunks add constraint ai_chunks_source_type_check
  check (source_type in ('document', 'drawing', 'induction', 'rfi', 'defect'));
alter table ai.ai_index_entries drop constraint ai_index_entries_source_type_check;
alter table ai.ai_index_entries add constraint ai_index_entries_source_type_check
  check (source_type in ('document', 'drawing', 'induction', 'rfi', 'defect'));
