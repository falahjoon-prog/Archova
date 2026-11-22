-- identity: sign-in with an outside identity provider (Google first). One row ties a person to the provider's stable
-- subject id (`sub`), which is what we match on at sign-in; the email is kept only as a record of what the provider said.
create table identity.external_identities (
  id         uuid primary key,
  user_id    uuid not null references identity.users (id) on delete cascade,
  provider   text not null check (provider in ('google')),
  subject    text not null,
  email      citext not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create unique index external_identities_subject on identity.external_identities (provider, subject);
create unique index external_identities_one_per_provider on identity.external_identities (user_id, provider);

select kernel.grant_module_schema('identity');
