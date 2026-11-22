-- identity: sessions opened by Google sign-in say so (`google`), so step-up and audit rules can tell them from
-- enterprise SSO. `credentials_reset_at` marks when a takeover of an unverified account was cut off: personal access
-- tokens made before it stop working in every org (Sam's review of Google sign-in).
alter table identity.sessions drop constraint sessions_auth_method_check;
alter table identity.sessions
  add constraint sessions_auth_method_check check (auth_method in ('password', 'passkey', 'sso', 'oauth', 'google'));
alter table identity.users add column credentials_reset_at timestamptz;
