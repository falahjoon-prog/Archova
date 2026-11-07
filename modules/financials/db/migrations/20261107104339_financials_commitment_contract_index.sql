-- archova:no-transaction
-- One contract backs at most one commitment.
create unique index concurrently if not exists commitments_contract
  on financials.commitments (contract_id) where contract_id is not null;
