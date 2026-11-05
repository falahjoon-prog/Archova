-- Composed from modules/workforce/db/migrations/20261105131500_workforce_wallet_evidence_retention_floor.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Sam's review of #316. (1) retain_until was whatever the inserting code said, and the access log row is inserted in
-- the builder's transaction, so an insert with retain_until = now() would have made the evidence deletable at once.
-- A BEFORE INSERT trigger now sets a floor (7 years for the access log, 10 for snapshots) that an insert can lengthen
-- but never shorten. (2) A platform hold must read exactly like a retention period to whoever hits the error, as in
-- the kernel's other guards, so the delete guard maps it to retention_period.

create function workforce.wallet_evidence_floor() returns trigger
  language plpgsql as $$
declare
  period interval := tg_argv[0]::interval;
begin
  new.retain_until := greatest(coalesce(new.retain_until, now() + period), now() + period);
  return new;
end;
$$;
create trigger compliance_access_log_floor before insert on workforce.compliance_access_log
  for each row execute function workforce.wallet_evidence_floor('7 years');
create trigger compliance_reliance_snapshots_floor before insert on workforce.compliance_reliance_snapshots
  for each row execute function workforce.wallet_evidence_floor('10 years');

create or replace function workforce.wallet_evidence_delete() returns trigger
  language plpgsql as $$
declare
  reason text;
begin
  if old.retain_until > now() then
    raise exception 'retention: % is kept until %', tg_table_name, old.retain_until using errcode = 'RT001';
  end if;
  reason := kernel.retention_block(
    old.org_id, tg_table_schema || '.' || tg_table_name, old.id,
    nullif(to_jsonb(old) ->> 'project_id', '')::uuid);
  if reason is not null then
    -- A platform hold reads like a retention period, so a customer cannot tell the two apart.
    raise exception 'retention: % cannot be deleted (%)', tg_table_name,
      case when reason = 'platform_hold' then 'retention_period' else reason end using errcode = 'RT001';
  end if;
  return old;
end;
$$;
