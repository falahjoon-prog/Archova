-- Composed from packages/kernel/db/migrations/20261002190000_access_links.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Access links for people without an account (X45, Sam security-licensing/11, schema/shared.md).
-- One mechanism for every module: a link stands in for one person doing one thing on one record.

create table shared.access_links (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid,
  entity_type      text not null check (length(entity_type) between 1 and 60),
  entity_id        uuid not null,
  allowed_actions  text[] not null check (cardinality(allowed_actions) between 1 and 10),
  label            text check (length(label) between 1 and 200),
  recipient_email  citext,
  recipient_phone  text check (recipient_phone ~ '^\+[1-9][0-9]{6,14}$'),
  -- SHA-256 of the whole token; the token itself is shown once.
  token_hash       char(64) not null unique,
  expires_at       timestamptz not null,
  max_uses         int check (max_uses >= 1),
  use_count        int not null default 0 check (use_count >= 0),
  last_used_at     timestamptz,
  revoked_at       timestamptz,
  revoked_by       uuid,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int not null default 1,
  check (revoked_at is null or revoked_by is not null)
);
create index access_links_entity on shared.access_links (org_id, entity_type, entity_id, created_at desc);
select kernel.enable_tenant_rls('shared.access_links');

-- A browser's session on one link (the `__Host-lnk` cookie). Verifying a code binds it to a person.
create table shared.access_link_sessions (
  id               uuid primary key,
  org_id           uuid not null,
  link_id          uuid not null references shared.access_links (id),
  token_hash       char(64) not null unique,
  verified_at      timestamptz,
  verified_channel text check (verified_channel in ('sms', 'email')),
  verified_to      text,
  -- What the person became in the module that owns the link (a workforce worker for inductions).
  subject_type     text,
  subject_id       uuid,
  ip               text,
  user_agent       text,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (verified_at is null or (verified_channel is not null and verified_to is not null))
);
create index access_link_sessions_link on shared.access_link_sessions (org_id, link_id);
select kernel.enable_tenant_rls('shared.access_link_sessions');

-- One-time codes: 6 digits, 10 minutes, 5 attempts. Only the hash is kept.
create table shared.access_link_codes (
  id           uuid primary key,
  org_id       uuid not null,
  session_id   uuid not null references shared.access_link_sessions (id),
  channel      text not null check (channel in ('sms', 'email')),
  destination  text not null,
  code_hash    char(64) not null,
  attempts     int not null default 0 check (attempts >= 0),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index access_link_codes_session on shared.access_link_codes (org_id, session_id, created_at desc);
create index access_link_codes_destination on shared.access_link_codes (org_id, destination, created_at desc);
select kernel.enable_tenant_rls('shared.access_link_codes');

select kernel.grant_module_schema('shared');
