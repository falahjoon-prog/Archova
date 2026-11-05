-- Each earlier entity-type migration re-created the check with only the values it knew about, so the later incident
-- migration dropped 'compliance_document' and wallet expiry alerts failed to insert. This sets the full list.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document'));
