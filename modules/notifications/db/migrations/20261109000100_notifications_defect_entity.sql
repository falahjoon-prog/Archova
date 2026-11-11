-- Adds 'defect' (every assignee has finished their part and the final approver is next) to the entity types a
-- notification can point at. Keeps every type from the migrations before it.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'permit', 'cover', 'announcement', 'warranty_item', 'defect'));
