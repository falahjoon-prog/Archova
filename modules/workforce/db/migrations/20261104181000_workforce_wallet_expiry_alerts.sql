-- Wallet expiry alerts (compliance/05 §6): one row per document, threshold (30, 7 or 0 days) and expiry date, so a
-- threshold is raised once however often the daily job runs, and again if the expiry date is renewed. Also adds
-- the ABN as a wallet item so its checksum can be checked on entry.

alter table workforce.compliance_documents drop constraint compliance_documents_item_type_check;
alter table workforce.compliance_documents add constraint compliance_documents_item_type_check
  check (item_type in (
    'contractor_licence', 'trade_licence', 'workers_comp', 'public_liability',
    'contract_works', 'professional_indemnity', 'personal_accident', 'home_warranty',
    'subcontractor_statement', 'plant_registration', 'test_and_tag', 'wwcc',
    'modern_slavery', 'abn', 'other'));

create table workforce.compliance_expiry_alerts (
  id          uuid primary key,
  org_id      uuid not null,
  document_id uuid not null references workforce.compliance_documents (id) on delete cascade,
  threshold   int not null check (threshold in (30, 7, 0)),
  expires_on  date not null,
  raised_on   date not null,
  created_at  timestamptz not null default now(),
  unique (document_id, threshold, expires_on)
);
create index compliance_expiry_alerts_org on workforce.compliance_expiry_alerts (org_id, raised_on desc);
select kernel.enable_tenant_rls('workforce.compliance_expiry_alerts');

select kernel.grant_module_schema('workforce');
