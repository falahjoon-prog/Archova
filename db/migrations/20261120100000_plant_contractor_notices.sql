-- Composed from modules/plant/db/migrations/20261120100000_plant_contractor_notices.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Who services a machine, and the notices staff send them from a Nova flag. A notice is queued with a snapshot of what it
-- says (the issue and due date as they stood) and the contractor's address at the time; the worker emails it and
-- records the outcome. The mail names the machine and the issue only, never rates, projects or other fleet data.
alter table plant.assets
  add column contractor_name  text check (contractor_name is null or length(contractor_name) between 1 and 200),
  add column contractor_email text check (contractor_email is null or (length(contractor_email) between 3 and 254 and contractor_email like '%_@_%'));

create table plant.contractor_notices (
  id              uuid primary key,
  org_id          uuid not null,
  asset_id        uuid not null references plant.assets (id),
  plan_id         uuid not null references plant.maintenance_plans (id),
  sender_id       uuid not null,
  recipient_name  text not null check (length(recipient_name) between 1 and 200),
  recipient_email text not null check (length(recipient_email) between 3 and 254),
  subject         text not null check (length(subject) between 1 and 200),
  issue           text not null check (length(issue) between 1 and 1000),
  due_on          date not null,
  message         text not null default '' check (length(message) <= 1000),
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts        int not null default 0,
  claimed_at      timestamptz,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index contractor_notices_by_asset on plant.contractor_notices (org_id, asset_id, created_at desc);
create index contractor_notices_by_plan on plant.contractor_notices (plan_id, created_at desc);
create index contractor_notices_queue on plant.contractor_notices (org_id, status, created_at)
  where status in ('queued', 'sending');
select kernel.enable_tenant_rls('plant.contractor_notices');

select kernel.grant_module_schema('plant');
