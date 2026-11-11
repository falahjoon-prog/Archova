-- Composed from modules/notifications/db/migrations/20261108210000_notifications_project_plan_entity.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Adds 'project_plan_item' (a request for an attachment or photo on an action plan item) to the entity types a notification can point at. Keeps every type from the migrations before it.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'permit', 'cover', 'announcement', 'warranty_item', 'project_plan_item'));
