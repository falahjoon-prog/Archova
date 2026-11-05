-- Composed from modules/workforce/db/migrations/20261105112000_workforce_equipment.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- workforce: equipment register, bookings and hours logs for a project (backend schema/later-phases.md, phase 5).
-- Scoped to a project so site managers see and book what is on their job; moving a machine to another job is a new row.

create table workforce.equipment (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  name          text not null check (length(name) between 1 and 200),
  asset_number  text not null check (length(asset_number) between 1 and 60),
  type          text not null check (length(type) between 1 and 100),
  status        text not null default 'available' check (status in ('available', 'in_use', 'maintenance', 'retired')),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  version       int not null default 1,
  unique (project_id, asset_number)
);
select kernel.enable_tenant_rls('workforce.equipment');

create table workforce.equipment_bookings (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  equipment_id  uuid not null references workforce.equipment (id),
  starts_on     date not null,
  ends_on       date not null,
  booked_for    text not null check (length(booked_for) between 1 and 200),
  note          text check (note is null or length(note) <= 2000),
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  created_at    timestamptz not null default now(),
  created_by    uuid,
  check (ends_on >= starts_on)
);
create index equipment_bookings_range on workforce.equipment_bookings (org_id, project_id, starts_on);
select kernel.enable_tenant_rls('workforce.equipment_bookings');

create table workforce.equipment_logs (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  equipment_id  uuid not null references workforce.equipment (id),
  log_date      date not null,
  hours         numeric(5, 2) not null check (hours > 0 and hours <= 24),
  operator      text check (operator is null or length(operator) between 1 and 200),
  notes         text check (notes is null or length(notes) <= 2000),
  created_at    timestamptz not null default now(),
  created_by    uuid
);
create index equipment_logs_equipment on workforce.equipment_logs (org_id, equipment_id, log_date);
select kernel.enable_tenant_rls('workforce.equipment_logs');

select kernel.grant_module_schema('workforce');
