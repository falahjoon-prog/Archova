-- Safety translations (F26, ai/12 §2 I4 and §3). One row per approved source version, language and glossary
-- version: each induction is translated once per language, however many workers read it. Rows are never updated
-- in place; a new source version, glossary or prompt version makes a new row. The payload's hash goes in the
-- worker's completion record (compliance/04 §3); the English version stays the official one.
create table ai.ai_translations (
  id                      uuid primary key,
  org_id                  uuid not null,
  project_id              uuid,
  -- `induction_version` for now; SWMS, toolbox talks and alerts follow in phase 2 (F26).
  source_type             text not null check (source_type in ('induction_version')),
  source_id               uuid not null,
  -- SHA-256 of the English content that was translated.
  source_hash             text not null,
  language                text not null,
  glossary_version        int not null,
  prompt_version          int not null,
  payload                 jsonb not null,
  -- SHA-256 of the translated content as shown, for the completion's evidence record.
  translation_hash        text not null,
  -- Share of items whose back-translation kept the meaning; the rest are shown in English.
  back_translation_score  real not null check (back_translation_score between 0 and 1),
  status                  text not null check (status in ('ready')),
  created_at              timestamptz not null default now(),
  created_by              uuid,
  unique (org_id, source_type, source_id, source_hash, language, glossary_version, prompt_version)
);
select kernel.enable_tenant_rls('ai.ai_translations');
grant select, insert on ai.ai_translations to app_rw;
