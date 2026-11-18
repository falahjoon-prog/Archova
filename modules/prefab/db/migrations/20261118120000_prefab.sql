-- prefab: prefabricated and modular construction. A project lists the units built off site (`units`: pods, wall
-- panels, volumetric modules), each moving from planned through fabrication, QA hold, ready to ship, in transit and
-- on site to installed. Every unit carries a QA checklist (`qa_checks`): required factory checks must pass before it
-- is released to ship, required site checks before it is signed off as installed. A unit may name the site delivery
-- that brings it (`delivery_id`, no foreign key, the delivery lives in `logistics`; `delivery_label` is what the person
-- saw when linking). Every change is written to `unit_events`.

create schema if not exists prefab;

create table prefab.units (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  number              int not null,
  code                text not null check (length(code) between 1 and 40),
  name                text not null check (length(name) between 1 and 200),
  kind                text not null check (kind in ('bathroom_pod', 'wall_panel', 'floor_cassette', 'volumetric_module', 'roof_truss', 'facade_panel', 'services_riser', 'other')),
  factory_name        text check (factory_name is null or length(factory_name) <= 200),
  supplier_company_id uuid,
  location            text check (location is null or length(location) <= 200),
  install_sequence    int check (install_sequence is null or install_sequence between 1 and 100000),
  weight_kg           int check (weight_kg is null or weight_kg between 1 and 1000000),
  dimensions          text check (dimensions is null or length(dimensions) <= 100),
  status              text not null default 'planned'
                        check (status in ('planned', 'in_fabrication', 'qa_hold', 'ready_to_ship', 'in_transit', 'on_site', 'installed', 'rejected')),
  progress_pct        int not null default 0 check (progress_pct between 0 and 100),
  fab_start           date,
  fab_due             date,
  ship_date           date,
  install_date        date,
  shipped_at          timestamptz,
  delivered_at        timestamptz,
  installed_at        timestamptz,
  status_reason       text check (status_reason is null or length(status_reason) <= 1000),
  delivery_id         uuid,
  delivery_label      text,
  notes               text check (notes is null or length(notes) <= 4000),
  created_at          timestamptz not null default now(),
  created_by          uuid,
  version             int not null default 1,
  unique (project_id, number),
  unique (project_id, code)
);
create index units_by_install on prefab.units (org_id, project_id, install_date);
select kernel.enable_tenant_rls('prefab.units');

create table prefab.qa_checks (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  unit_id     uuid not null references prefab.units (id),
  stage       text not null check (stage in ('factory', 'site')),
  label       text not null check (length(label) between 1 and 200),
  required    boolean not null default true,
  result      text not null default 'pending' check (result in ('pending', 'pass', 'fail', 'na')),
  note        text check (note is null or length(note) <= 1000),
  checked_at  timestamptz,
  checked_by  uuid,
  sort_order  int not null default 0
);
create index qa_checks_by_unit on prefab.qa_checks (org_id, unit_id, sort_order);
select kernel.enable_tenant_rls('prefab.qa_checks');

create table prefab.unit_events (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  unit_id     uuid not null references prefab.units (id),
  kind        text not null check (kind in ('created', 'updated', 'started', 'held', 'resumed', 'ready', 'shipped', 'delivered', 'installed', 'rejected', 'reopened', 'check_recorded', 'check_added')),
  detail      text check (detail is null or length(detail) <= 2000),
  at          timestamptz not null default now(),
  by_user     uuid
);
create index unit_events_by_unit on prefab.unit_events (org_id, unit_id, at);
select kernel.enable_tenant_rls('prefab.unit_events');

select kernel.grant_module_schema('prefab');
