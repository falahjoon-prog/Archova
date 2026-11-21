-- A confirmed hazard signal can be raised as a safety observation in the same step. The link is written with the
-- decision (the signal is still open then), so the lock on decided signals keeps it from changing afterwards.
alter table ai.ai_hazard_signals add column observation_id uuid;
