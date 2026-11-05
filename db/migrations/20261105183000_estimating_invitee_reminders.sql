-- Composed from modules/estimating/db/migrations/20261105183000_estimating_invitee_reminders.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Reminder emails to invited companies that have not answered. One claim row per invite, stage and due time, written
-- before the email is sent, so a repeated or re-delivered job never emails a company twice; a failed send gives the
-- claim back. Moving the due date re-arms the reminders (the due time is part of the key).

create table estimating.invite_reminders (
  org_id     uuid not null,
  invite_id  uuid not null,
  stage      text not null check (stage in ('two_days', 'one_day')),
  due_at     timestamptz not null,
  claimed_at timestamptz not null default now(),
  primary key (invite_id, stage, due_at)
);
select kernel.enable_tenant_rls('estimating.invite_reminders');

alter table estimating.package_invites add column last_reminded_at timestamptz;
-- Set while reminders are held because the package's creator has lost access, so dead links are not mailed.
alter table estimating.tender_packages add column invite_reminders_paused_at timestamptz;

select kernel.grant_module_schema('estimating');
