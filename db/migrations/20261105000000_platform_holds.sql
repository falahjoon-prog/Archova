-- Composed from packages/kernel/db/migrations/20261105000000_platform_holds.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Platform legal holds (compliance/07, APP 11.2): a hold placed by Archova staff, for example on a regulator's or a
-- court's request, on one org or one project. Unlike shared.legal_holds, a customer can neither place nor release it
-- (every tenant transaction sets app.org_id, a staff transaction sets nothing), and it is never listed to customers.
-- Placing needs one person because it only restricts; releasing needs a different person because it enables deletion.

-- True in a staff (global) transaction, which sets no org.
create function kernel.is_global_context() returns boolean language sql stable as $$
  select nullif(current_setting('app.org_id', true), '') is null
$$;

create table shared.platform_holds (
  id          uuid primary key,
  -- Always one org; there is no hold on every org.
  org_id      uuid not null,
  project_id  uuid,
  reason      text not null check (length(reason) between 1 and 500),
  -- The ticket or request that asked for the hold.
  reference   text not null check (length(reference) between 2 and 60),
  placed_by   uuid not null,
  placed_at   timestamptz not null default now(),
  released_by uuid,
  released_at timestamptz,
  release_reason text check (length(release_reason) between 1 and 500),
  check ((released_at is null) = (released_by is null) and (released_at is null) = (release_reason is null)),
  check (released_by is null or released_by <> placed_by)
);
create index platform_holds_active on shared.platform_holds (org_id, project_id) where released_at is null;

-- Enables and forces RLS like every tenant table; the standard policy would let a tenant write, so it is replaced.
select kernel.enable_tenant_rls('shared.platform_holds');
drop policy tenant_isolation on shared.platform_holds;
-- A tenant transaction sees only its own org's holds (so the delete guard can), and writes nothing.
create policy platform_holds_read on shared.platform_holds for select
  using (kernel.is_global_context() or org_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy platform_holds_insert on shared.platform_holds for insert with check (kernel.is_global_context());
create policy platform_holds_release on shared.platform_holds for update
  using (kernel.is_global_context()) with check (kernel.is_global_context());

-- Append-only apart from the release, which must be by someone else, once, now.
create function kernel.platform_hold_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'retention: platform holds are never deleted, release them' using errcode = 'RT001';
  end if;
  if (new.id, new.org_id, new.project_id, new.reason, new.reference, new.placed_by, new.placed_at)
     is distinct from (old.id, old.org_id, old.project_id, old.reason, old.reference, old.placed_by, old.placed_at)
     or old.released_at is not null then
    raise exception 'retention: a platform hold can only be released' using errcode = 'RT001';
  end if;
  if new.released_by is null or new.release_reason is null or new.released_by = old.placed_by
     or abs(extract(epoch from (new.released_at - now()))) > 1 then
    raise exception 'retention: a platform hold is released now, by someone other than the person who placed it'
      using errcode = 'RT001';
  end if;
  return new;
end $$;
create trigger platform_hold_guard before update or delete on shared.platform_holds
  for each row execute function kernel.platform_hold_guard();

-- 'platform_hold' is checked first so the order of reasons never depends on what else applies.
create or replace function kernel.retention_block(p_org uuid, p_type text, p_id uuid, p_project uuid)
returns text language sql stable as $$
  select case
    when exists (
      select 1 from shared.platform_holds h
      where h.org_id = p_org and h.released_at is null and (h.project_id is null or h.project_id = p_project)
    ) then 'platform_hold'
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

-- A platform hold reads as an ordinary retention block in database errors too, so logs a customer might be shown
-- do not tell them a hold exists.
create or replace function kernel.enforce_retention() returns trigger language plpgsql as $$
declare
  j      jsonb := to_jsonb(old);
  reason text;
begin
  reason := kernel.retention_block(
    (j ->> 'org_id')::uuid, tg_table_schema || '.' || tg_table_name, (j ->> 'id')::uuid,
    nullif(j ->> coalesce(tg_argv[0], 'project_id'), '')::uuid);
  if reason is not null then
    raise exception 'retention: % cannot be deleted (%)', tg_table_schema || '.' || tg_table_name,
      case when reason = 'platform_hold' then 'retention_period' else reason end
      using errcode = 'RT001';
  end if;
  return old;
end $$;

select kernel.grant_module_schema('shared');
