-- Composed from modules/notifications/db/migrations/20261121130000_notifications_induction_entity.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Induction expiry reminders point at the induction register.

alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'permit', 'cover', 'announcement', 'warranty_item', 'defect', 'declaration', 'induction'));
