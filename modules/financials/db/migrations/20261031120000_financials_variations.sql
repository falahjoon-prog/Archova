-- financials: variations to a contract (CLM-AC12/13). An approved variation becomes a claimable line on a payment
-- claim, capped at its amount. Amounts are positive additions ex GST.

create table financials.variations (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  contract_id      uuid not null references financials.contracts (id),
  number           int not null,
  title            text not null check (length(title) between 1 and 300),
  description      text,
  amount           numeric(18,2) not null check (amount > 0),
  time_impact_days int not null default 0 check (time_impact_days >= 0),
  status           text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'withdrawn')),
  submitted_at     timestamptz,
  decided_at       timestamptz,
  decided_by       uuid,
  decision_note    text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  version          int not null default 1,
  unique (contract_id, number),
  check (status <> 'rejected' or decision_note is not null)
);
create index variations_contract on financials.variations (org_id, contract_id, number);
select kernel.enable_tenant_rls('financials.variations');

-- A claim line is against a schedule-of-values item or an approved variation, never both.
alter table financials.payment_claim_lines
  alter column sov_item_id drop not null,
  add column variation_id uuid references financials.variations (id),
  add constraint payment_claim_lines_one_target check ((sov_item_id is null) <> (variation_id is null));

select kernel.grant_module_schema('financials');
