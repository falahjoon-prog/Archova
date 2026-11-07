-- Composed from modules/notifications/db/migrations/20261105050211_notifications_tender_entity.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Notifications can now point at a tender package (bid due reminders) as well as a meeting.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check check (entity_type in ('meeting', 'tender_package'));
