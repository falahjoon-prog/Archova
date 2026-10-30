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
