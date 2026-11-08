-- Composed from modules/logistics/db/migrations/20261107123000_logistics.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- logistics: site logistics for material deliveries. A project lists the places and machines deliveries use
-- (`resources`: unloading docks and laydown areas, cranes, hoists, lifts, forklifts), and books each delivery into a
-- time window at a dock, with an optional lift booking at a crane, hoist or lift. Clashes are not blocked, because a
-- dock can take several trucks (`capacity`); the service flags them instead. Each delivery may point at the purchase
-- order it fulfils (`commitment_id`, no foreign key, the order lives in `financials`; `commitment_label` is what the
-- person saw when linking). Every status change is written to `delivery_events`.

create schema if not exists logistics;

create table logistics.resources (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  name        text not null check (length(name) between 1 and 120),
  kind        text not null check (kind in ('dock', 'laydown', 'crane', 'hoist', 'lift', 'forklift')),
  capacity    int not null default 1 check (capacity between 1 and 20),
  active      boolean not null default true,
  note        text check (note is null or length(note) <= 1000),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  version     int not null default 1,
  unique (project_id, name)
);
select kernel.enable_tenant_rls('logistics.resources');

create table logistics.deliveries (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  number            int not null,
  title             text not null check (length(title) between 1 and 200),
  supplier_name     text not null check (length(supplier_name) between 1 and 200),
  supplier_company_id uuid,
  supplier_contact  text check (supplier_contact is null or length(supplier_contact) <= 200),
  supplier_email    text check (supplier_email is null or length(supplier_email) <= 320),
  supplier_phone    text check (supplier_phone is null or length(supplier_phone) <= 40),
  items             jsonb not null default '[]'::jsonb,
  window_start      timestamptz not null,
  window_end        timestamptz not null,
  zone_id           uuid references logistics.resources (id),
  needs_lift        boolean not null default false,
  lift_resource_id  uuid references logistics.resources (id),
  lift_start        timestamptz,
  lift_end          timestamptz,
  vehicle           text check (vehicle is null or length(vehicle) <= 200),
  access_notes      text check (access_notes is null or length(access_notes) <= 2000),
  status            text not null default 'scheduled'
                      check (status in ('scheduled', 'arrived', 'unloaded', 'delayed', 'missed', 'cancelled')),
  arrived_at        timestamptz,
  unloaded_at       timestamptz,
  status_reason     text check (status_reason is null or length(status_reason) <= 1000),
  commitment_id     uuid,
  commitment_label  text,
  created_at        timestamptz not null default now(),
  created_by        uuid,
  version           int not null default 1,
  check (window_end > window_start),
  check ((lift_start is null) = (lift_end is null)),
  check (lift_end is null or lift_end > lift_start),
  unique (project_id, number)
);
create index deliveries_by_window on logistics.deliveries (org_id, project_id, window_start);
select kernel.enable_tenant_rls('logistics.deliveries');

create table logistics.delivery_events (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  delivery_id  uuid not null references logistics.deliveries (id),
  kind         text not null check (kind in ('created', 'updated', 'rescheduled', 'arrived', 'unloaded', 'delayed', 'missed', 'cancelled', 'notice_drafted')),
  detail       text check (detail is null or length(detail) <= 2000),
  at           timestamptz not null default now(),
  by_user      uuid
);
create index delivery_events_by_delivery on logistics.delivery_events (org_id, delivery_id, at);
select kernel.enable_tenant_rls('logistics.delivery_events');

select kernel.grant_module_schema('logistics');
