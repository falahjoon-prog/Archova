-- Restores 'compliance_document' to the entity-type check. 20261105113000 re-created the check from an older list and
-- dropped it, which would reject wallet expiry alerts. This is the full list of entity types the module points at.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document'));
