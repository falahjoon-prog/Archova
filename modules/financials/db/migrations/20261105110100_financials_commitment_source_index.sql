-- archova:no-transaction
-- One quote raises at most one commitment.
create unique index concurrently if not exists commitments_source_quote
  on financials.commitments (source_quote_id) where source_quote_id is not null;
