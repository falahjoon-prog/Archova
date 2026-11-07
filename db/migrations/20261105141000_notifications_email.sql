-- Composed from modules/notifications/db/migrations/20261105141000_notifications_email.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Email copies of inbox notifications. `emailed_at` is the claim: the worker sets it before sending, so a rerun or a
-- second worker sends nothing twice, and clears it again if every send failed so the next run retries. Null means
-- not emailed (yet, or by choice: only the kinds a job asks for are ever emailed).

alter table notifications.notifications add column emailed_at timestamptz;
