-- Composed from modules/notifications/db/migrations/20261105170000_notifications_entity_types_all.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Each earlier entity-type migration re-created the check with only the values it knew about, so the later incident
-- migration dropped 'compliance_document' and wallet expiry alerts failed to insert. This sets the full list.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document'));
