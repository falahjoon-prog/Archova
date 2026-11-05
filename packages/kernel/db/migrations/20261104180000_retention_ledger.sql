-- Retention ledger and legal holds (compliance/07, security-licensing/07 §6, APP 11.2).
-- A record in the ledger cannot be deleted until its retention period has passed, and nothing in an org (or one
-- project) can be deleted while a legal hold is in force. The guard is a trigger, so it also stops erasure jobs and
-- cascades that never go through application code. Periods are only ever extended, never shortened.

create table shared.retention_ledger (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid,
  -- schema.table of the record, as the guard trigger sees it.
  record_type  text not null check (record_type ~ '^[a-z_]+\.[a-z_0-9]+$'),
  record_id    uuid not null,
  category     text not null check (category in (
    'financial_7y', 'timesheet_7y', 'sign_in_7y', 'induction_7y', 'audit_log_7y',
    'sopa_evidence_10y', 'project_records_10y', 'tax_gst_5y', 'whs_incident_5y',
    'location_at_sign_in_12m', 'health_monitoring_30y', 'asbestos_monitoring_40y')),
  retain_until timestamptz not null,
  created_at   timestamptz not null default now(),
  -- Extension is irreversible, so a bad anchor must not lock a record forever.
  check (retain_until <= created_at + interval '50 years'),
  unique (org_id, record_type, record_id, category)
);
create index retention_ledger_record on shared.retention_ledger (org_id, record_type, record_id);
select kernel.enable_tenant_rls('shared.retention_ledger');

create table shared.legal_holds (
  id          uuid primary key,
  org_id      uuid not null,
  -- Null holds the whole org.
  project_id  uuid,
  reason      text not null check (length(reason) between 1 and 500),
  placed_by   uuid not null,
  placed_at   timestamptz not null default now(),
  released_by uuid,
  released_at timestamptz,
  check ((released_at is null) = (released_by is null))
);
create index legal_holds_active on shared.legal_holds (org_id, project_id) where released_at is null;
select kernel.enable_tenant_rls('shared.legal_holds');

-- Ledger rows may only be extended; they may be deleted only once the period has passed.
create function kernel.retention_ledger_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.retain_until > now() then
      raise exception 'retention: ledger entry is still in force until %', old.retain_until using errcode = 'RT001';
    end if;
    return old;
  end if;
  if (new.id, new.org_id, new.project_id, new.record_type, new.record_id, new.category)
     is distinct from (old.id, old.org_id, old.project_id, old.record_type, old.record_id, old.category)
     or new.retain_until < old.retain_until then
    raise exception 'retention: a ledger entry can only be extended' using errcode = 'RT001';
  end if;
  return new;
end $$;
create trigger retention_ledger_guard before update or delete on shared.retention_ledger
  for each row execute function kernel.retention_ledger_guard();

-- A hold is released by update, never deleted, and nothing about it changes except the release.
create function kernel.legal_hold_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'retention: legal holds are never deleted, release them' using errcode = 'RT001';
  end if;
  if (new.id, new.org_id, new.project_id, new.reason, new.placed_by, new.placed_at)
     is distinct from (old.id, old.org_id, old.project_id, old.reason, old.placed_by, old.placed_at)
     or (old.released_at is not null
         and (new.released_at is distinct from old.released_at or new.released_by is distinct from old.released_by)) then
    raise exception 'retention: a legal hold can only be released' using errcode = 'RT001';
  end if;
  -- A release names who did it and happens now, so the release time cannot be backdated.
  if old.released_at is null and new.released_at is not null
     and (new.released_by is null or abs(extract(epoch from (new.released_at - now()))) > 1) then
    raise exception 'retention: a release needs released_by and the current time' using errcode = 'RT001';
  end if;
  return new;
end $$;
create trigger legal_hold_guard before update or delete on shared.legal_holds
  for each row execute function kernel.legal_hold_guard();

-- Why a record cannot be deleted now: 'legal_hold', 'retention_period', or null when it can.
create function kernel.retention_block(p_org uuid, p_type text, p_id uuid, p_project uuid)
returns text language sql stable as $$
  select case
    when exists (
      select 1 from shared.legal_holds h
      where h.org_id = p_org and h.released_at is null and (h.project_id is null or h.project_id = p_project)
    ) then 'legal_hold'
    when exists (
      select 1 from shared.retention_ledger l
      where l.org_id = p_org and l.record_type = p_type and l.record_id = p_id and l.retain_until > now()
    ) then 'retention_period'
  end
$$;

-- Row trigger behind kernel.enable_retention_guard: refuses the delete while a hold or the ledger says keep it.
create function kernel.enforce_retention() returns trigger language plpgsql as $$
declare
  j      jsonb := to_jsonb(old);
  reason text;
begin
  reason := kernel.retention_block(
    (j ->> 'org_id')::uuid, tg_table_schema || '.' || tg_table_name, (j ->> 'id')::uuid,
    nullif(j ->> coalesce(tg_argv[0], 'project_id'), '')::uuid);
  if reason is not null then
    raise exception 'retention: % cannot be deleted (%)', tg_table_schema || '.' || tg_table_name, reason
      using errcode = 'RT001';
  end if;
  return old;
end $$;

-- Call after creating any table that holds records someone may have to keep. `project_column` names the column that
-- holds the row's project (the projects table passes 'id'); rows with no project are only stopped by an org hold.
create function kernel.enable_retention_guard(tbl regclass, project_column text default 'project_id')
returns void language plpgsql as $$
begin
  execute format(
    'create trigger enforce_retention before delete on %s for each row execute function kernel.enforce_retention(%L)',
    tbl, project_column);
end $$;

select kernel.grant_module_schema('shared');
