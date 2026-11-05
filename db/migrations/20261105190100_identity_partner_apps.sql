-- Composed from modules/identity/db/migrations/20261105190100_identity_partner_apps.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- identity: third-party partner apps for the public API (integrations/06 §1, §4; Sam's review 2026-11-05).
-- An app is an `oauth_clients` row owned by one org (`owner_org_id`). An org owner or admin installs it into that org:
-- the install records the scopes they approved. Tokens are bound to the install, so revoking it ends every token at
-- once, and each request re-checks the install is live.

alter table identity.oauth_clients
  add column if not exists description text,
  add column if not exists disabled_at timestamptz;

create table identity.app_installs (
  id           uuid primary key,
  org_id       uuid not null,
  client_id    text not null references identity.oauth_clients (client_id),
  installed_by uuid not null references identity.users (id),
  scopes       text[] not null check (cardinality(scopes) > 0),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid
);
-- One live install of an app per org; a revoked one can be installed again as a new row.
create unique index app_installs_live on identity.app_installs (org_id, client_id) where revoked_at is null;
create index app_installs_org on identity.app_installs (org_id, created_at desc);
select kernel.enable_tenant_rls('identity.app_installs');

-- Append-only trail of what happened to an app or its installs, and who did it.
create table identity.app_events (
  id         uuid primary key,
  org_id     uuid not null,
  client_id  text not null,
  install_id uuid,
  event      text not null check (event in
               ('app_created', 'secret_rotated', 'installed', 'scope_changed', 'revoked', 'reuse_detected')),
  user_id    uuid,
  ip         text,
  -- e.g. the old and new scopes of a re-approved install
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index app_events_org on identity.app_events (org_id, created_at desc);
select kernel.enable_tenant_rls('identity.app_events');

-- The trail is evidence for the customer: once written, a row cannot be changed or removed, not even by the app role.
create function identity.app_events_immutable() returns trigger
  language plpgsql as $$
begin
  raise exception 'identity.app_events is append-only';
end;
$$;
create trigger app_events_no_update before update or delete on identity.app_events
  for each row execute function identity.app_events_immutable();
create trigger app_events_no_truncate before truncate on identity.app_events
  for each statement execute function identity.app_events_immutable();

-- Authorisation codes: single use, 60 seconds, PKCE S256. Global like oauth_codes (the token endpoint has no org yet).
create table identity.app_codes (
  code_hash      bytea primary key,
  client_id      text not null,
  user_id        uuid not null references identity.users (id) on delete cascade,
  target_org_id  uuid not null,
  install_id     uuid not null,
  -- the token family this code will start, so a replayed code can end everything issued from it
  family_id      uuid not null,
  redirect_uri   text not null,
  code_challenge text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz
);

-- Access (1 hour) and refresh tokens (30 days idle, 90 days absolute), opaque and stored as SHA-256 only.
create table identity.app_tokens (
  id             uuid primary key,
  install_id     uuid not null,
  target_org_id  uuid not null,
  user_id        uuid not null references identity.users (id) on delete cascade,
  kind           text not null check (kind in ('access', 'refresh')),
  token_hash     bytea not null unique,
  family_id      uuid not null,
  scopes         text[] not null,
  expires_at     timestamptz not null,
  absolute_expires_at timestamptz not null,
  used_at        timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index app_tokens_install on identity.app_tokens (install_id);

select kernel.grant_module_schema('identity');
