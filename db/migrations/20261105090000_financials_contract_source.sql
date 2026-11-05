-- Composed from modules/financials/db/migrations/20261105090000_financials_contract_source.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- A subcontract can be raised from an awarded tender quote. The link is a reference, not a foreign key: the quote
-- lives in the estimating schema. One quote raises at most one contract.

alter table financials.contracts
  add column source_package_id uuid,
  add column source_quote_id   uuid;

create unique index contracts_source_quote on financials.contracts (source_quote_id) where source_quote_id is not null;
