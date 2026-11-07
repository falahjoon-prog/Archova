-- notifications: a warranty item can be what a notification is about (expiry reminders).
alter table notifications.notifications drop constraint if exists notifications_entity_type_check;
alter table notifications.notifications add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'warranty_item'));
