-- Composed from modules/financials/db/migrations/20261107110000_financials_owner_invoices.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Owner invoice drafts pre-filled from approved subcontractor claims. A draft names the head contract it is billed on,
-- the subcontractor claims compiled into it (each at the amount taken, with the flags Nova raised and who confirmed
-- them) and the markup. A claim can sit on one draft only, so it is never passed up to the owner twice; discarding a
-- draft frees its claims. Issuing the owner claim stays on the existing claim flow.

create table financials.owner_invoices (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  contract_id   uuid not null references financials.contracts (id),
  number        int not null,
  period_end    date not null,
  markup_pct    numeric(6,2) not null default 0 check (markup_pct between 0 and 100),
  sub_total     numeric(18,2) not null check (sub_total >= 0),
  markup_amount numeric(18,2) not null check (markup_amount >= 0),
  total         numeric(18,2) not null check (total >= 0),
  note          text check (length(note) <= 1000),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  version       int not null default 1,
  unique (contract_id, number)
);
create index owner_invoices_project on financials.owner_invoices (org_id, project_id, contract_id);
select kernel.enable_tenant_rls('financials.owner_invoices');

create table financials.owner_invoice_sources (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  owner_invoice_id    uuid not null references financials.owner_invoices (id) on delete cascade,
  claim_id            uuid not null references financials.payment_claims (id) unique,
  amount              numeric(18,2) not null,
  flags               jsonb not null default '[]',
  flags_confirmed_by  uuid,
  flags_confirmed_at  timestamptz
);
create index owner_invoice_sources_invoice on financials.owner_invoice_sources (org_id, owner_invoice_id);
select kernel.enable_tenant_rls('financials.owner_invoice_sources');

select kernel.grant_module_schema('financials');
