-- Composed from modules/ai/db/migrations/20261104010000_ai_contract_playbooks.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Nova contract review (F34, design/09 CR4): the builder's playbook, one row per topic and contract type. The
-- preferred position and the severity of a departure are the builder's; the fallback wording is wording the
-- builder's lawyer approved, and the only wording Nova ever offers for a flagged clause. Nova never writes any.
create table ai.ai_contract_playbook_topics (
  id                    uuid primary key,
  org_id                uuid not null,
  contract_type         text not null check (contract_type in ('head_contract', 'subcontract', 'consultant_agreement')),
  key                   text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  topic                 text not null,
  position              text not null,
  threshold             text,
  severity              text not null check (severity in ('high', 'medium', 'low')),
  sort_order            int not null default 0,
  fallback_title        text,
  fallback_wording      text,
  fallback_approved_by  text,
  fallback_approved_on  date,
  -- Past this date the wording is not offered until the builder renews it.
  fallback_review_by    date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  version               int not null default 1,
  unique (org_id, contract_type, key),
  -- Wording comes with who approved it and when, or not at all.
  check (
    (fallback_wording is null and fallback_title is null and fallback_approved_by is null and fallback_approved_on is null)
    or (fallback_wording is not null and fallback_title is not null and fallback_approved_by is not null and fallback_approved_on is not null)
  )
);
select kernel.enable_tenant_rls('ai.ai_contract_playbook_topics');
grant select, insert, update, delete on ai.ai_contract_playbook_topics to app_rw;

-- Every replace of a contract type's playbook keeps a snapshot of what was saved and who saved it, so a change to
-- the lawyer-approved wording can be traced. Rows are never updated or deleted.
create table ai.ai_contract_playbook_history (
  id             uuid primary key,
  org_id         uuid not null,
  contract_type  text not null check (contract_type in ('head_contract', 'subcontract', 'consultant_agreement')),
  topics         jsonb not null,
  saved_by       uuid,
  saved_at       timestamptz not null default now()
);
select kernel.enable_tenant_rls('ai.ai_contract_playbook_history');
grant select, insert on ai.ai_contract_playbook_history to app_rw;
