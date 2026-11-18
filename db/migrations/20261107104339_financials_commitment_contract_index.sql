-- Composed from modules/financials/db/migrations/20261107104339_financials_commitment_contract_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- One contract backs at most one commitment.
create unique index concurrently if not exists commitments_contract
  on financials.commitments (contract_id) where contract_id is not null;
