-- financials: where a T&M sign-off was recorded. The device position (if it gave one) and whether it fell inside the
-- project's site fence are stored with the server timestamp already on the sign-off. 'unknown' means no position or
-- no fence was set; an 'outside' or 'uncertain' sign-off is flagged for office review, not refused.
-- The sign-off guard trigger still makes the row immutable; these columns are written at insert time only.

alter table financials.tm_ticket_signoffs
  add column lat double precision check (lat is null or lat between -90 and 90),
  add column lng double precision check (lng is null or lng between -180 and 180),
  add column accuracy_m integer check (accuracy_m is null or accuracy_m between 0 and 100000),
  add column geofence_status text not null default 'unknown' check (geofence_status in ('inside', 'outside', 'uncertain', 'unknown')),
  add constraint tm_signoffs_fix_pair check ((lat is null) = (lng is null));
