-- Composed from modules/ai/db/migrations/20261002130000_ai_chunks.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Ask Nova retrieval (ai/03 §3–5). Retrievable text with its embedding, one row per chunk of a document or drawing
-- revision page. Keyword search uses Postgres full-text search until OpenSearch arrives (ai/03 §7); vectors use
-- pgvector (the `vector` extension is created by the bootstrap, like citext). Both run under RLS (ai/04 §2).
create table ai.ai_chunks (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  -- `document` (documents.documents) or `drawing` (documents.drawing_revisions); source_id is the document id or
  -- the drawing sheet id, so every revision of one record shares it.
  source_type       text not null check (source_type in ('document', 'drawing')),
  source_id         uuid not null,
  revision_id       uuid not null,
  revision_label    text not null,
  title             text not null,
  -- Document or sheet number as printed, for citations and keyword search.
  reference         text,
  page              int not null check (page >= 1),
  chunk_index       int not null check (chunk_index >= 0),
  text              text not null check (char_length(text) <= 8000),
  tsv               tsvector generated always as (
                      setweight(to_tsvector('english', coalesce(reference, '') || ' ' || title), 'A') ||
                      setweight(to_tsvector('english', text), 'B')
                    ) stored,
  embedding         vector(1024) not null,
  embedding_model   text not null,
  -- Who may retrieve it (ai/03 §5): `drawings` for the drawing register, `folder:<id>` for a document. The
  -- documents module says which scopes a user holds; retrieval filters on them inside the query (ai/04 §3).
  access_scope      text not null,
  -- current = the default retrieval set; superseded = an older revision, kept for "as at rev B" and audit.
  status            text not null check (status in ('current', 'superseded')),
  pipeline_version  int not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, revision_id, page, chunk_index, pipeline_version)
);
create index ai_chunks_scope on ai.ai_chunks (org_id, project_id, status, access_scope);
create index ai_chunks_source on ai.ai_chunks (org_id, source_type, source_id);
create index ai_chunks_tsv on ai.ai_chunks using gin (tsv);
-- No ANN (HNSW) index yet: queries are always filtered to one project and the user's scopes, and an exact scan of a
-- project's chunks is both fast enough at phase 1 sizes and never misses a filtered match (an HNSW index filters
-- after its candidate search). Add one with iterative scans once a project passes ~100k chunks (ai/03 §7).
select kernel.enable_tenant_rls('ai.ai_chunks');

-- Which revisions the indexer has processed, so re-runs skip finished work and scans without text aren't retried
-- on every run (ai/03 §3 step 7: keyed by revision and pipeline version).
create table ai.ai_index_entries (
  org_id            uuid not null,
  project_id        uuid not null,
  revision_id       uuid not null,
  pipeline_version  int not null,
  source_type       text not null check (source_type in ('document', 'drawing')),
  source_id         uuid not null,
  outcome           text not null check (outcome in ('indexed', 'no_text', 'unsupported')),
  pages             int not null default 0,
  chunks            int not null default 0,
  created_at        timestamptz not null default now(),
  primary key (org_id, revision_id, pipeline_version)
);
create index ai_index_entries_project on ai.ai_index_entries (org_id, project_id);
select kernel.enable_tenant_rls('ai.ai_index_entries');

grant select, insert, update, delete on ai.ai_chunks, ai.ai_index_entries to app_rw;

-- Embedding calls are logged like any model call but have no tier.
alter table ai.ai_requests drop constraint ai_requests_tier_check;
alter table ai.ai_requests add constraint ai_requests_tier_check
  check (tier in ('fast', 'standard', 'advanced', 'embedding'));
