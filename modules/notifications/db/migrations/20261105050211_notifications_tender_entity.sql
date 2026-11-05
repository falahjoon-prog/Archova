-- Notifications can now point at a tender package (bid due reminders) as well as a meeting.
alter table notifications.notifications drop constraint notifications_entity_type_check;
alter table notifications.notifications
  add constraint notifications_entity_type_check check (entity_type in ('meeting', 'tender_package'));
