-- Composed from modules/plant/db/migrations/20261120130000_plant_contractor_phone.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Contractors can also be reached by text. A notice goes by one channel: `email` and `sms` (through the SMS provider) are
-- queued for the worker; `phone` means the sender texted from their own phone, so it is recorded as sent at once and
-- nothing is queued.
alter table plant.assets
  add column contractor_phone text check (contractor_phone is null or contractor_phone ~ '^\+[0-9]{9,15}$');

alter table plant.contractor_notices
  add column channel text not null default 'email' check (channel in ('email', 'sms', 'phone')),
  add column recipient_phone text check (recipient_phone is null or recipient_phone ~ '^\+[0-9]{9,15}$'),
  alter column recipient_email drop not null,
  add check ((channel = 'email' and recipient_email is not null) or (channel <> 'email' and recipient_phone is not null));

select kernel.grant_module_schema('plant');
