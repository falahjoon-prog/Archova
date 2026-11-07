-- Composed from modules/financials/db/migrations/20261104160000_financials_payments.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: payments against a claim (backend schema/financials.md "payments"). Append-only: a payment reversed in
-- the accounting system is a new row with a negative amount that points at the original, never a delete (Leo L5).
create table financials.payments (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  claim_id              uuid not null references financials.payment_claims (id),
  paid_on               date not null,
  -- negative for a reversal
  amount                numeric(18,2) not null check (amount <> 0),
  reference             text not null,
  -- manual | xero | myob
  source                text not null check (source in ('manual', 'xero', 'myob')),
  external_ref          text,
  reverses_payment_id   uuid references financials.payments (id),
  recorded_at           timestamptz not null default now(),
  check (source = 'manual' or external_ref is not null),
  check ((reverses_payment_id is null) = (amount > 0))
);
-- A connector payment lands once however often it is pulled.
create unique index payments_external on financials.payments (org_id, source, external_ref)
  where external_ref is not null;
create index payments_claim on financials.payments (org_id, claim_id, paid_on);
select kernel.enable_tenant_rls('financials.payments');

create function financials.payments_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'payments are append-only; record a reversal instead' using errcode = 'P0001';
end $$;
create trigger payments_append_only before update or delete on financials.payments
  for each row execute function financials.payments_append_only();

select kernel.grant_module_schema('financials');
