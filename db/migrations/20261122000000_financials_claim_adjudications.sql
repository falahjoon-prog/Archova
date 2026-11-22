-- Composed from modules/financials/db/migrations/20261122000000_financials_claim_adjudications.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: what actually happened once a claimant went to adjudication on a payment claim. One row per claim,
-- kept by builder staff from the dates on the notices they receive or send. Nothing here is computed: the apply-by
-- windows come from the SOPA rule row in force (see the claim timeline), and the response and determination due
-- dates are entered from the adjudicator's own notice because the Acts set them from events (acceptance, receipt)
-- that the app cannot see. The row can be edited as facts arrive; kept 7 years like the claim, so deletes are refused once tagged.

create table financials.claim_adjudications (
  id                       uuid primary key,
  claim_id                 uuid not null references financials.payment_claims (id) unique,
  org_id                   uuid not null,
  project_id               uuid not null,
  notice_served_on         date,
  application_lodged_on    date,
  nominating_authority     text check (nominating_authority is null or length(nominating_authority) between 1 and 200),
  adjudicator_name         text check (adjudicator_name is null or length(adjudicator_name) between 1 and 200),
  adjudicator_appointed_on date,
  response_due_on          date,
  response_lodged_on       date,
  determination_due_on     date,
  determined_on            date,
  adjudicated_amount       numeric(18, 2) check (adjudicated_amount is null or adjudicated_amount >= 0),
  outcome                  text check (outcome is null or outcome in ('upheld', 'part_upheld', 'dismissed', 'withdrawn', 'settled')),
  notes                    text check (notes is null or length(notes) <= 2000),
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  version                  int not null default 1,
  check (outcome is null or determined_on is not null or outcome in ('withdrawn', 'settled'))
);
create index claim_adjudications_project on financials.claim_adjudications (org_id, project_id);
select kernel.enable_tenant_rls('financials.claim_adjudications');
select kernel.enable_retention_guard('financials.claim_adjudications');
select kernel.grant_module_schema('financials');
