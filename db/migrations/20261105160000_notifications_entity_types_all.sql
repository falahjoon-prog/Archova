-- Composed from modules/notifications/db/migrations/20261105160000_notifications_entity_types_all.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Each earlier migration replaced the whole entity_type list from its own copy, so the incident one (20261105113000)
-- dropped compliance_document, which wallet expiry alerts use. Restore every type the module emits.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document'));
