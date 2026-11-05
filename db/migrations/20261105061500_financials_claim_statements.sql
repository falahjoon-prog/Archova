-- Composed from modules/financials/db/migrations/20261105061500_financials_claim_statements.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- NSW subcontractor's statement linked to a payment claim (compliance/05 §6). One per claim: the claim period it
-- covers, when it was received and the day it was signed. The claim's contract decides whether one is expected
-- (NSW, subcontract); the warning is computed from this table and never stored. Whether the principal may withhold
-- payment without one is a question for the lawyer, so nothing here blocks a claim or a schedule.
-- Kept 7 years (compliance/05 §7), so deletes are refused once tagged.

create table financials.claim_statements (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  claim_id     uuid not null references financials.payment_claims (id) unique,
  period_end   date not null,
  received_on  date not null,
  signed_on    date,
  note         text check (length(note) <= 500),
  recorded_by  uuid,
  recorded_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int not null default 1,
  check (signed_on is null or signed_on <= received_on)
);
create index claim_statements_project on financials.claim_statements (org_id, project_id);
select kernel.enable_tenant_rls('financials.claim_statements');
select kernel.enable_retention_guard('financials.claim_statements');

select kernel.grant_module_schema('financials');
