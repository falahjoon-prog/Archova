-- A commitment can be raised from an awarded tender quote. The link is a reference to the estimating schema; one
-- quote raises at most one commitment (the unique index is in the next migration).
alter table financials.commitments
  add column if not exists source_package_id uuid,
  add column if not exists source_quote_id   uuid;
