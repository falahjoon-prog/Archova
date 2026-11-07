-- Composed from modules/notifications/db/migrations/20261107110100_notifications_form_submission_entity.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Adds 'form_submission' (a form assigned to someone) to the entity types a notification can point at.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'form_submission'));
