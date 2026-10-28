-- Ask Nova answers from the site diary too (ai/01 F2, ai/03 §3). A submitted or signed-off day (weather, notes, labour,
-- plant, deliveries, delays and events) is chunked into ai_chunks with `source_type = diary` and `access_scope = diary`
-- (builder staff who read the whole diary). source_id is the diary entry id and revision_id a hash of the day's text,
-- so an amended line or a sign-off indexes as a new revision and the old chunks drop.
alter table ai.ai_chunks drop constraint ai_chunks_source_type_check;
alter table ai.ai_chunks add constraint ai_chunks_source_type_check
  check (source_type in ('document', 'drawing', 'induction', 'rfi', 'defect', 'diary'));
alter table ai.ai_index_entries drop constraint ai_index_entries_source_type_check;
alter table ai.ai_index_entries add constraint ai_index_entries_source_type_check
  check (source_type in ('document', 'drawing', 'induction', 'rfi', 'defect', 'diary'));
