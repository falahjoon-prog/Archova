-- Retention for the wallet's evidence tables (compliance/05 §7, compliance/07). The access log and reliance snapshots
-- were append-only with no way out, so nothing could ever be erased, even after the retention period or when a
-- customer is entitled to have it gone. They are still never updated, but a row can now be deleted once its own
-- retain_until has passed and no legal hold applies. The date is on the row itself (not the retention ledger)
-- because the access log row belongs to the subbie but is written in the builder's transaction, which cannot write
-- the subbie's ledger entries. Legal holds (org or project) are still checked through kernel.retention_block.
--   access log (security audit trail of who looked): 7 years, like the security audit log
--   reliance snapshots (the builder's record of what it relied on): 10 years, like project records
-- Rows that exist now take the full period from today, which is longer than policy and never shorter.

alter table workforce.compliance_access_log
  add column retain_until timestamptz not null default now() + interval '7 years';
alter table workforce.compliance_reliance_snapshots
  add column retain_until timestamptz not null default now() + interval '10 years';

drop trigger compliance_access_log_append_only on workforce.compliance_access_log;
drop trigger compliance_reliance_snapshots_append_only on workforce.compliance_reliance_snapshots;

-- Never updated, not even by the application role.
create function workforce.compliance_no_update() returns trigger
  language plpgsql as $$
begin
  raise exception '% rows are never updated', tg_table_name;
end;
$$;
create trigger compliance_access_log_no_update before update on workforce.compliance_access_log
  for each row execute function workforce.compliance_no_update();
create trigger compliance_reliance_snapshots_no_update before update on workforce.compliance_reliance_snapshots
  for each row execute function workforce.compliance_no_update();

-- Deleted only after the row's own period, and never under a legal hold. The column is not updatable, so the
-- date cannot be pulled forward. Fails closed on both.
create function workforce.wallet_evidence_delete() returns trigger
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
    raise exception 'retention: % cannot be deleted (%)', tg_table_name, reason using errcode = 'RT001';
  end if;
  return old;
end;
$$;
create trigger compliance_access_log_delete before delete on workforce.compliance_access_log
  for each row execute function workforce.wallet_evidence_delete();
create trigger compliance_reliance_snapshots_delete before delete on workforce.compliance_reliance_snapshots
  for each row execute function workforce.wallet_evidence_delete();

select kernel.grant_module_schema('workforce');
