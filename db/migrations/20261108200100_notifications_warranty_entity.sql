-- Composed from modules/notifications/db/migrations/20261108200100_notifications_warranty_entity.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- notifications: a warranty item can be what a notification is about (expiry reminders). Keeps every earlier entity type.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'permit', 'cover', 'announcement', 'warranty_item'));
