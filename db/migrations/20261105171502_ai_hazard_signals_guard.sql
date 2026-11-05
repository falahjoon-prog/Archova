-- Composed from modules/ai/db/migrations/20261105171502_ai_hazard_signals_guard.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Hazard signals are safety records: kept 5 years (retention ledger, tagged by the scan) and never deleted under a
-- hold. Once a manager has confirmed or dismissed a signal it is locked: the observation, the decision and who
-- made it can't change, so the pattern counts can't be rewritten after the fact.
select kernel.enable_retention_guard('ai.ai_hazard_signals');

create function ai.hazard_signals_lock_decided() returns trigger language plpgsql as $$
begin
  if old.status <> 'open' then
    raise exception 'ai.ai_hazard_signals: a decided signal cannot be changed' using errcode = 'RT002';
  end if;
  return new;
end $$;
create trigger hazard_signals_lock_decided before update on ai.ai_hazard_signals
  for each row execute function ai.hazard_signals_lock_decided();
