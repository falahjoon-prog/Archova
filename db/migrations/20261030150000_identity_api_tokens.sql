-- Composed from modules/identity/db/migrations/20261030150000_identity_api_tokens.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
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
select kernel.grant_module_schema('identity');
