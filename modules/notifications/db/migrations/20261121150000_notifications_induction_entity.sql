-- Induction expiry reminders point at the induction register.

alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document', 'conversation', 'permit', 'cover', 'announcement', 'warranty_item', 'defect', 'declaration', 'induction'));
