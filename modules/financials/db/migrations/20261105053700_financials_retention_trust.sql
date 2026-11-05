-- financials: retention and project trust records (compliance/01 §7, decision D5: record-and-remind in phase 2).
-- One trust profile per contract, and an append-only ledger of money moved into and out of the trust account. No
-- full bank account numbers are stored: only the last four digits, to tell accounts apart.
create table financials.trust_accounts (
  id                 uuid primary key,
  org_id             uuid not null,
  project_id         uuid not null,
  contract_id        uuid not null references financials.contracts (id),
  government_client  boolean not null default false,
  institution        text,
  account_name       text,
  account_last4      text check (account_last4 ~ '^[0-9]{4}$'),
  opened_on          date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid
);
create unique index trust_accounts_contract on financials.trust_accounts (org_id, contract_id);
select kernel.enable_tenant_rls('financials.trust_accounts');

create table financials.trust_movements (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  trust_account_id      uuid not null references financials.trust_accounts (id),
  kind                  text not null check (kind in ('deposit', 'interest', 'release', 'reversal')),
  -- positive into the account, negative out of it; a reversal is the opposite of the row it points at
  amount                numeric(18,2) not null check (amount <> 0),
  moved_on              date not null,
  reference             text not null,
  note                  text,
  reverses_movement_id  uuid references financials.trust_movements (id),
  recorded_at           timestamptz not null default now(),
  recorded_by           uuid,
  check ((kind = 'reversal') = (reverses_movement_id is not null)),
  check (kind not in ('deposit', 'interest') or amount > 0),
  check (kind <> 'release' or amount < 0)
);
create unique index trust_movements_reversal on financials.trust_movements (reverses_movement_id)
  where reverses_movement_id is not null;
create index trust_movements_account on financials.trust_movements (org_id, trust_account_id, moved_on);
select kernel.enable_tenant_rls('financials.trust_movements');

create function financials.trust_movements_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'trust movements are append-only; record a reversal instead' using errcode = 'P0001';
end $$;
create trigger trust_movements_append_only before update or delete on financials.trust_movements
  for each row execute function financials.trust_movements_append_only();

select kernel.grant_module_schema('financials');
