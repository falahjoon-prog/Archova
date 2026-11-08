-- Composed from modules/notifications/db/migrations/20261107141000_notifications_cover_entity.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Adds 'cover' (an expiring or expired subcontractor insurance certificate or bond) to the entity types a notification
-- can point at. 'permit' is listed too so this stays correct whichever of the two registers is migrated first.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'permit', 'cover'));
