-- Adds 'announcement' (a project broadcast or a reminder to read one) to the entity types a notification can point at. Keeps 'permit' and 'cover' from the migrations before it.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'permit', 'cover', 'announcement'));
