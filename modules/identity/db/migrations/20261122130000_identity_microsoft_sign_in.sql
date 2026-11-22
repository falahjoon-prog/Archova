-- identity: "Continue with Microsoft" joins "Continue with Google". Outside identities and sessions may now name `microsoft`.
alter table identity.external_identities drop constraint if exists external_identities_provider_check;
alter table identity.external_identities
  add constraint external_identities_provider_check check (provider in ('google', 'microsoft'));

alter table identity.sessions drop constraint if exists sessions_auth_method_check;
alter table identity.sessions
  add constraint sessions_auth_method_check check (auth_method in ('password', 'passkey', 'sso', 'oauth', 'google', 'microsoft'));
