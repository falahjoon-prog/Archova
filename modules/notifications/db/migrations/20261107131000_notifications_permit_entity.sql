-- Adds 'permit' (an expiring or expired project permit) to the entity types a notification can point at.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'permit'));
