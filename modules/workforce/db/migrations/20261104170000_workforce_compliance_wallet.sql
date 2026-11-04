-- Subcontractor compliance wallet, first slice (compliance/05, E5): the evidence a company holds about itself.
-- Documents stay in the holder's org. Status words are "recorded", "sighted" or "self_declared", never
-- "verified" (§4). Only the last four characters of a number are kept (§7: collect the minimum); full-number
-- encryption, register checks, requirement profiles, grants and alerts follow.

create table workforce.compliance_documents (
  id             uuid primary key,
  org_id         uuid not null,
  item_type      text not null check (item_type in (
                   'contractor_licence', 'trade_licence', 'workers_comp', 'public_liability',
                   'contract_works', 'professional_indemnity', 'personal_accident', 'home_warranty',
                   'subcontractor_statement', 'plant_registration', 'test_and_tag', 'wwcc',
                   'modern_slavery', 'other')),
  title          text not null check (length(title) between 1 and 200),
  number_last4   text check (length(number_last4) between 1 and 4),
  issuing_state  text check (issuing_state in ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),
  licence_class  text check (length(licence_class) <= 200),
  insurer        text check (length(insurer) <= 200),
  limit_cents    bigint check (limit_cents >= 0),
  starts_on      date,
  expires_on     date,
  file_ids       uuid[] not null default '{}',
  evidence       text not null default 'recorded' check (evidence in ('recorded', 'sighted', 'self_declared')),
  sighted_by     uuid,
  sighted_at     timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  version        int not null default 1,
  check (cardinality(file_ids) <= 4),
  -- Anything but a declaration needs the document itself.
  check (evidence = 'self_declared' or cardinality(file_ids) >= 1),
  check (evidence <> 'sighted' or (sighted_by is not null and sighted_at is not null)),
  check (starts_on is null or expires_on is null or starts_on <= expires_on)
);
create index compliance_documents_org on workforce.compliance_documents (org_id, item_type, expires_on)
  where archived_at is null;
select kernel.enable_tenant_rls('workforce.compliance_documents');

select kernel.grant_module_schema('workforce');
