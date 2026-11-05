-- Composed from modules/identity/db/migrations/20261105160000_identity_account_deleted.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- identity: a deleted account (the in-app deletion the app stores require). The row stays so records other people
-- keep (authored by, signed by) still point at someone, but nothing about the person remains: the name, email,
-- phone and avatar are cleared, every credential, session and token is gone, and the email is free to sign up again.
alter table identity.users drop constraint users_status_check;
alter table identity.users add constraint users_status_check check (status in ('active', 'disabled', 'deleted'));
alter table identity.users add column deleted_at timestamptz;
