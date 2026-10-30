-- identity: personal access tokens for the public API (integrations/06 §1-2). A token belongs to one user and one
-- organisation and carries a set of scopes that can only narrow what that user may do. A tenant table (RLS on org_id):
-- the API takes the org from the URL and looks the token up inside it, so a token never resolves in another org.
-- The secret is shown once; only its SHA-256 is stored.

create table identity.api_tokens (
  id           uuid primary key,
  org_id       uuid not null,
  user_id      uuid not null references identity.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  -- first characters of the token, so a person can tell tokens apart in a list
  prefix       text not null,
  token_hash   bytea not null unique,
  scopes       text[] not null check (cardinality(scopes) > 0),
  expires_at   timestamptz not null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index api_tokens_org on identity.api_tokens (org_id, created_at desc);
create index api_tokens_user on identity.api_tokens (user_id);
select kernel.enable_tenant_rls('identity.api_tokens');

-- Who created, revoked and first used a token, and from where. Append-only; tokens are never deleted, so the trail
-- outlives them.
create table identity.api_token_events (
  id         uuid primary key,
  org_id     uuid not null,
  token_id   uuid not null references identity.api_tokens (id),
  event      text not null check (event in ('created', 'revoked', 'first_used')),
  user_id    uuid not null,
  ip         text,
  created_at timestamptz not null default now()
);
create index api_token_events_token on identity.api_token_events (org_id, token_id, created_at);
select kernel.enable_tenant_rls('identity.api_token_events');
select kernel.grant_module_schema('identity');
