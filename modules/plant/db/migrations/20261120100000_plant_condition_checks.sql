-- plant: photos of a machine's condition when it is hired in, hired out or serviced, kept for damage disputes,
-- insurance claims and checking the right unit arrived. The photos are held by file id only (the files module owns
-- them, as for prefab QA checks); the service checks each is a ready plant file before storing the list. The links to
-- an allocation or a maintenance record are optional and carry no foreign key on purpose: the photos outlive both.

create table plant.condition_checks (
  id             uuid primary key,
  org_id         uuid not null,
  asset_id       uuid not null references plant.assets (id),
  kind           text not null check (kind in ('hire_in', 'hire_out', 'service')),
  allocation_id  uuid references plant.allocations (id),
  record_id      uuid references plant.maintenance_records (id),
  taken_on       date not null,
  note           text check (note is null or length(note) <= 2000),
  file_ids       uuid[] not null check (cardinality(file_ids) between 1 and 10),
  created_at     timestamptz not null default now(),
  created_by     uuid
);
create index condition_checks_by_asset on plant.condition_checks (org_id, asset_id, taken_on desc);
select kernel.enable_tenant_rls('plant.condition_checks');
