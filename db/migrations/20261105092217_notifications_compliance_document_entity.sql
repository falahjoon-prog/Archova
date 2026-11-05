-- Composed from modules/notifications/db/migrations/20261105092217_notifications_compliance_document_entity.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Notifications can now point at a compliance wallet document (an expiry alert).
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document'));
