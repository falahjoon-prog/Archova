-- Composed from modules/financials/db/migrations/20261107104137_financials_commitment_contract.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- A subcontract commitment can be linked to the claims contract its payment claims are made on. The Invoices tab on
-- the commitment is a view over that contract's claims, so nothing is copied. One contract belongs to at most one
-- commitment.
alter table financials.commitments
  add column if not exists contract_id uuid references financials.contracts (id);
create unique index if not exists commitments_contract
  on financials.commitments (contract_id) where contract_id is not null;
