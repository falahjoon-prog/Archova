-- 20261105113000 rebuilt the entity_type check without 'compliance_document' (added by 20261105092217), so wallet
-- expiry alerts failed to insert. Forward-only repair: the check now allows every entity type in use.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('meeting', 'tender_package', 'contract', 'incident', 'compliance_document'));
