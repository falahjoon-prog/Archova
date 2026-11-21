-- Composed from modules/audit/db/migrations/20261121120000_audit_security_log.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- audit: the security audit log (security-licensing/07 §3-4, §9). Logins, API tokens, exports, member changes and
-- support access, each event hash-chained to the one before it in its org, so an edit or a deletion anywhere breaks the
-- chain. Events with no org (a sign-in happens before an org is chosen) go in one platform chain under the nil org id.
--
-- app_rw can neither insert into nor change any audit table. The only ways to write are the security-definer functions
-- audit.append_event(), audit.record_anchor() and audit.verify_chain(); each is bound to the caller's tenant context,
-- which runs as the table owner, takes the chain's row lock, computes the hash and raises alerts. Triggers refuse
-- UPDATE, DELETE and TRUNCATE for everyone.

create schema audit;
grant usage on schema audit to app_rw;

create table audit.chain_heads (
  org_id    uuid primary key,          -- nil uuid = the platform chain
  last_seq  bigint not null,
  last_hash bytea not null
);

create table audit.security_events (
  id          uuid primary key,
  org_id      uuid not null,
  seq         bigint not null,
  occurred_at timestamptz not null,
  actor_type  text not null check (actor_type in ('user', 'api_client', 'system', 'support', 'staff', 'anonymous')),
  actor_id    uuid,
  ip          text,
  user_agent  text,
  client      text check (client in ('web', 'ios', 'android', 'api')),
  action      text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  target_type text,
  target_id   text,
  request_id  text,
  -- {field: [before, after]}. Passwords, tokens and MFA secrets are never put here (doc 07 §3).
  changes     jsonb not null default '{}',
  metadata    jsonb not null default '{}',
  prev_hash   bytea not null,
  hash        bytea not null,
  unique (org_id, seq)
);
create index security_events_org_time on audit.security_events (org_id, occurred_at desc, id desc);
create index security_events_org_action on audit.security_events (org_id, action, occurred_at desc);
create index security_events_target on audit.security_events (org_id, action, target_id, occurred_at desc);

-- Rows here are written only by the security-definer functions below (record_anchor).
create table audit.chain_anchors (
  id           uuid primary key,
  org_id       uuid not null,
  seq          bigint not null,
  hash         bytea not null,
  object_key   text,                   -- the Object Lock copy; null when no write-once store is configured
  anchored_at  timestamptz not null default now(),
  unique (org_id, seq)
);

create table audit.verification_runs (
  id            uuid primary key,
  org_id        uuid not null,
  checked       bigint not null,
  ok            boolean not null,
  first_bad_seq bigint,
  problem       text,
  head_seq      bigint,
  ran_at        timestamptz not null default now()
);
create index verification_runs_org on audit.verification_runs (org_id, ran_at desc);

create table audit.alerts (
  id         uuid primary key,
  org_id     uuid not null,
  rule       text not null,
  severity   text not null check (severity in ('info', 'medium', 'high')),
  summary    text not null,
  event_id   uuid references audit.security_events (id),
  created_at timestamptz not null default now()
);
create index alerts_org on audit.alerts (org_id, created_at desc);

-- No UPDATE, DELETE or TRUNCATE on any audit table except the chain heads (which only move forward).
create function audit.refuse_change() returns trigger language plpgsql as $$
begin
  raise exception 'audit.% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;
create function audit.refuse_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'audit.% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;
do $$
declare t text;
begin
  foreach t in array array['security_events', 'chain_anchors', 'verification_runs', 'alerts'] loop
    execute format('create trigger append_only before update or delete on audit.%I for each row execute function audit.refuse_change()', t);
    execute format('create trigger no_truncate before truncate on audit.%I for each statement execute function audit.refuse_truncate()', t);
  end loop;
end $$;

-- Row security (kernel.enable_tenant_rls: enabled, forced, org-scoped): a tenant sees its own org's rows only, and app_rw
-- holds no write privilege here beyond the two inserts granted at the end. The migrating role owns the security-definer
-- functions below and gets an all-rows policy, so they can write and verify across the platform chain; nothing else
-- runs as that role at request time.
select kernel.enable_tenant_rls('audit.chain_heads');
select kernel.enable_tenant_rls('audit.security_events');
select kernel.enable_tenant_rls('audit.chain_anchors');
select kernel.enable_tenant_rls('audit.verification_runs');
select kernel.enable_tenant_rls('audit.alerts');
do $$
declare t text;
begin
  foreach t in array array['security_events', 'chain_anchors', 'verification_runs', 'alerts', 'chain_heads'] loop
    execute format('create policy function_owner on audit.%I to %I using (true) with check (true)', t, current_user);
  end loop;
end $$;

-- The text the hash covers. One definition, used to write and to verify, so the two cannot drift.
create function audit.canonical(e audit.security_events) returns text language sql immutable as $$
  select jsonb_build_object(
    'id', e.id, 'orgId', e.org_id, 'seq', e.seq,
    'occurredAt', to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actorType', e.actor_type, 'actorId', e.actor_id, 'ip', e.ip, 'userAgent', e.user_agent, 'client', e.client,
    'action', e.action, 'targetType', e.target_type, 'targetId', e.target_id, 'requestId', e.request_id,
    'changes', e.changes, 'metadata', e.metadata)::text
$$;

create function audit.link_hash(prev bytea, e audit.security_events) returns bytea language sql immutable as $$
  select sha256(prev || convert_to(audit.canonical(e), 'UTF8'))
$$;

create function audit.raise_alert(p_org uuid, p_rule text, p_severity text, p_summary text, p_event uuid)
returns void language sql as $$
  insert into audit.alerts (id, org_id, rule, severity, summary, event_id)
  values (gen_random_uuid(), p_org, p_rule, p_severity, p_summary, p_event)
$$;

-- The platform chain is sharded: an event with no org lands in one of 16 chains, chosen by its target, so unauthenticated
-- traffic does not queue on one row. Shard n has org id 00000000-0000-0000-0000-0000000000<nn>; real orgs never use them.
create function audit.platform_shard(p_key text) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000000' || lpad(to_hex((abs(hashtextextended(coalesce(p_key, ''), 0)) % 16)::int), 2, '0'))::uuid
$$;

-- The org the caller is acting in, or null when none is set (a global transaction) or it is the self-scope nil id.
create function audit.current_org() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('app.org_id', true), ''), '00000000-0000-0000-0000-000000000000')::uuid
$$;

-- Appends one event to its chain and applies the real-time alert rules (doc 07 §9). The chain head row is locked for the
-- rest of the transaction, so concurrent writers to one chain queue briefly and the seq has no gaps.
--
-- p_org must be the org the transaction runs in (app.org_id), or null in a transaction that has none, in which case the
-- event joins a platform shard. A caller therefore cannot write into another org's chain. Code that records an event for
-- an org from a global transaction (support access) first sets app.org_id for that org, deliberately and visibly.
-- Failed sign-ins beyond 20 per account and address in 15 minutes are not stored (returns null): the alert fires at 10.
-- changes and metadata over 8 KB are replaced by {"truncated": true}.
create function audit.append_event(
  p_org uuid, p_actor_type text, p_actor_id uuid, p_action text,
  p_target_type text default null, p_target_id text default null,
  p_ip text default null, p_user_agent text default null, p_client text default null,
  p_request_id text default null, p_changes jsonb default '{}', p_metadata jsonb default '{}'
) returns uuid
language plpgsql security definer set search_path = pg_catalog, audit as $$
declare
  cur uuid := audit.current_org();
  org uuid;
  head audit.chain_heads;
  e audit.security_events;
  failed int;
begin
  if p_org is distinct from cur then
    raise exception 'audit event for org % from a transaction in org %', p_org, cur using errcode = 'insufficient_privilege';
  end if;
  org := coalesce(p_org, audit.platform_shard(p_target_id));

  if p_org is null and p_action = 'auth.login.failed' then
    select count(*) into failed from audit.security_events
     where org_id = org and action = 'auth.login.failed' and target_id = p_target_id
       and ip is not distinct from p_ip and occurred_at > clock_timestamp() - interval '15 minutes';
    if failed >= 20 then return null; end if;
  end if;

  insert into audit.chain_heads (org_id, last_seq, last_hash)
  values (org, 0, decode(repeat('00', 32), 'hex'))
  on conflict (org_id) do nothing;
  select * into head from audit.chain_heads where org_id = org for update;

  e.id := gen_random_uuid();
  e.org_id := org;
  e.seq := head.last_seq + 1;
  e.occurred_at := date_trunc('microseconds', clock_timestamp());
  e.actor_type := p_actor_type; e.actor_id := p_actor_id; e.ip := p_ip; e.user_agent := left(p_user_agent, 300);
  e.client := p_client; e.action := p_action; e.target_type := p_target_type; e.target_id := p_target_id;
  e.request_id := p_request_id;
  e.changes := coalesce(p_changes, '{}');
  e.metadata := coalesce(p_metadata, '{}');
  if length(e.changes::text) > 8192 then e.changes := '{"truncated": true}'; end if;
  if length(e.metadata::text) > 8192 then e.metadata := '{"truncated": true}'; end if;
  e.prev_hash := head.last_hash;
  e.hash := audit.link_hash(head.last_hash, e);
  insert into audit.security_events values (e.*);
  update audit.chain_heads set last_seq = e.seq, last_hash = e.hash where org_id = org;

  -- Alert rules. Ten failed sign-ins on one account in 15 minutes, once an hour per account.
  if p_action = 'auth.login.failed' and p_target_id is not null then
    select count(*) into failed from audit.security_events
     where org_id = org and action = 'auth.login.failed' and target_id = p_target_id
       and occurred_at > e.occurred_at - interval '15 minutes';
    if failed >= 10 and not exists (
      select 1 from audit.alerts where org_id = org and rule = 'auth.repeated_failures'
         and created_at > now() - interval '1 hour' and summary like '%' || left(p_target_id, 12) || '%') then
      perform audit.raise_alert(org, 'auth.repeated_failures', 'high',
        failed || ' failed sign-ins in 15 minutes on account ' || left(p_target_id, 12), e.id);
    end if;
  elsif p_action = 'support.session.started' then
    perform audit.raise_alert(org, 'support.session_started', 'high', 'An Archova support session was opened', e.id);
  elsif p_action = 'sso.config.changed' then
    perform audit.raise_alert(org, 'sso.config_changed', 'high', 'Single sign-on settings were changed', e.id);
  elsif p_action = 'api_token.created' and coalesce(p_metadata->>'hasWriteScope', 'false') = 'true' then
    perform audit.raise_alert(org, 'api_token.write_scope', 'medium', 'An API token with write access was created', e.id);
  elsif p_action = 'export.requested' then
    perform audit.raise_alert(org, 'export.requested', 'medium', 'A full data export was requested', e.id);
  end if;
  return e.id;
end $$;

-- Re-walks one chain from the start: every link, every hash, no gaps, the head, and every anchor. Internal: callers use
-- audit.verify_chain, which records the run.
create function audit.walk_chain(p_org uuid)
returns table (ok boolean, checked bigint, first_bad_seq bigint, problem text, head_seq bigint)
language plpgsql security definer set search_path = pg_catalog, audit as $$
declare
  e audit.security_events;
  prev bytea := decode(repeat('00', 32), 'hex');
  expect bigint := 1;
  n bigint := 0;
  h audit.chain_heads;
  a audit.chain_anchors;
  stored bytea;
begin
  for e in select * from audit.security_events where org_id = p_org order by seq loop
    n := n + 1;
    if e.seq <> expect then
      return query select false, n, expect, 'Missing event: expected seq ' || expect || ' but found ' || e.seq, null::bigint; return;
    end if;
    if e.prev_hash <> prev then
      return query select false, n, e.seq, 'Event does not follow the one before it', null::bigint; return;
    end if;
    if e.hash <> audit.link_hash(prev, e) then
      return query select false, n, e.seq, 'Event content does not match its hash', null::bigint; return;
    end if;
    prev := e.hash; expect := e.seq + 1;
  end loop;
  select * into h from audit.chain_heads where org_id = p_org;
  if found and (h.last_seq <> expect - 1 or h.last_hash <> prev) then
    return query select false, n, expect, 'Chain head does not match the last event (events removed from the end?)', h.last_seq; return;
  end if;
  for a in select * from audit.chain_anchors where org_id = p_org order by seq loop
    select hash into stored from audit.security_events where org_id = p_org and seq = a.seq;
    if stored is null or stored <> a.hash then
      return query select false, n, a.seq, 'Event does not match the hash anchored at seq ' || a.seq, h.last_seq; return;
    end if;
  end loop;
  return query select true, n, null::bigint, null::text, coalesce(h.last_seq, 0);
end $$;

-- Verifies the chain of the org the transaction runs in (a platform shard is "an org" here: the job runs with the
-- shard id as app.org_id), records the run, and raises an alert when it fails.
create function audit.verify_chain(p_org uuid)
returns table (ok boolean, checked bigint, first_bad_seq bigint, problem text, head_seq bigint)
language plpgsql security definer set search_path = pg_catalog, audit as $$
declare
  r record;
begin
  if p_org is distinct from nullif(current_setting('app.org_id', true), '')::uuid then
    raise exception 'verify_chain runs for the current org only' using errcode = 'insufficient_privilege';
  end if;
  select * into r from audit.walk_chain(p_org);
  insert into audit.verification_runs (id, org_id, checked, ok, first_bad_seq, problem, head_seq)
  values (gen_random_uuid(), p_org, r.checked, r.ok, r.first_bad_seq, r.problem, r.head_seq);
  if not r.ok then
    perform audit.raise_alert(p_org, 'audit.chain_broken', 'high', 'Security log verification failed: ' || left(r.problem, 200), null);
  end if;
  return query select r.ok, r.checked, r.first_bad_seq, r.problem, r.head_seq;
end $$;

-- Records that the chain up to p_seq was pinned outside the database. The hash is read from the event itself, never
-- supplied by the caller. A no-op if that seq is already anchored.
create function audit.record_anchor(p_org uuid, p_seq bigint, p_object_key text) returns void
language plpgsql security definer set search_path = pg_catalog, audit as $$
begin
  if p_org is distinct from nullif(current_setting('app.org_id', true), '')::uuid then
    raise exception 'record_anchor runs for the current org only' using errcode = 'insufficient_privilege';
  end if;
  insert into audit.chain_anchors (id, org_id, seq, hash, object_key)
  select gen_random_uuid(), org_id, seq, hash, p_object_key
    from audit.security_events where org_id = p_org and seq = p_seq
  on conflict (org_id, seq) do nothing;
end $$;

revoke all on function audit.append_event, audit.verify_chain, audit.record_anchor from public;
grant execute on function audit.append_event, audit.verify_chain, audit.record_anchor to app_rw;
grant select on audit.security_events, audit.chain_heads, audit.chain_anchors, audit.verification_runs, audit.alerts to app_rw;
