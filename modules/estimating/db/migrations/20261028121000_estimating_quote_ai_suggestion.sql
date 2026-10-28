-- estimating: a quote made from a Nova reading of its PDF keeps the reading's id (ai/10 E3), so the "lines and prices
-- read correctly" bar can compare the reading with the confirmed quote. A plain id into ai.ai_suggestions, never a FK.
alter table estimating.quotes add column if not exists ai_suggestion_id uuid;
