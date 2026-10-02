-- Composed from modules/identity/db/migrations/20261002000200_identity.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- identity: global module (ADR-0005), lives in the cell's global layer. No org_id, no RLS;
-- only the identity module's repositories touch these tables. Behaviour: security-licensing/01.
-- Org-scoped identity tables (sso_connections, scim_tokens, personal_access_tokens) arrive with SSO work.

create schema if not exists identity;

create table identity.users (
  id                uuid primary key,
  email             citext not null unique,
  email_verified_at timestamptz,
  name              text not null,
  phone             text,
  avatar_file_id    uuid,
  locale            text not null default 'en-AU',
  timezone          kernel.time_zone,
  status            text not null default 'active' check (status in ('active', 'disabled')),
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger set_updated_at before update on identity.users for each row execute function kernel.set_updated_at();

create table identity.credentials (
  id                    uuid primary key,
  user_id               uuid not null references identity.users (id) on delete cascade,
  type                  text not null check (type in ('password', 'totp', 'passkey')),
  secret_hash           text,
  passkey_public_key    bytea,
  passkey_credential_id bytea unique,
  last_used_at          timestamptz,
  created_at            timestamptz not null default now()
);
create unique index credentials_one_password on identity.credentials (user_id) where type = 'password';
create index credentials_user on identity.credentials (user_id);

-- Durable copy of sessions (ADR-0004 §1). `id` is the `sid`; the cookie carries a random token whose
-- SHA-256 is `token_hash`, so a database read never yields a usable cookie. Hot copy in Redis.
create table identity.sessions (
  id                  uuid primary key,
  token_hash          bytea unique,
  user_id             uuid not null references identity.users (id) on delete cascade,
  client              text not null check (client in ('web', 'ios', 'android', 'api')),
  auth_method         text not null check (auth_method in ('password', 'passkey', 'sso', 'oauth')),
  auth_time           timestamptz not null,
  ip                  inet,
  user_agent          text,
  device_name         text,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  idle_expires_at     timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at          timestamptz
);
create index sessions_user on identity.sessions (user_id) where revoked_at is null;

create table identity.refresh_tokens (
  id          uuid primary key,
  session_id  uuid not null references identity.sessions (id) on delete cascade,
  token_hash  bytea not null unique,
  family_id   uuid not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index refresh_tokens_session on identity.refresh_tokens (session_id);
create index refresh_tokens_family on identity.refresh_tokens (family_id);

create table identity.oauth_clients (
  id                 uuid primary key,
  client_id          text not null unique,
  name               text not null,
  client_secret_hash text,
  first_party        boolean not null default false,
  redirect_uris      text[] not null,
  scopes             text[] not null default '{}',
  owner_org_id       uuid,
  created_at         timestamptz not null default now()
);

-- Authorisation codes for OAuth 2.1 code + PKCE (S256 only). Single use, 60 seconds.
create table identity.oauth_codes (
  code_hash      bytea primary key,
  client_id      text not null references identity.oauth_clients (client_id),
  user_id        uuid not null references identity.users (id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,
  auth_method    text not null,
  auth_time      timestamptz not null,
  expires_at     timestamptz not null,
  used_at        timestamptz
);
create index oauth_codes_user on identity.oauth_codes (user_id);

-- First-party mobile client (Mia). Redirect uses the app scheme from apps/mobile/app.json.
insert into identity.oauth_clients (id, client_id, name, first_party, redirect_uris, scopes)
values ('01920000-0000-7000-8000-000000000001', 'archova-mobile', 'Archova for iOS and Android', true,
        array['com.archova.app:/oauth/callback'], array['*']);

select kernel.grant_module_schema('identity');
