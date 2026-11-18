-- quality: the inspection record page. Private flag, distribution list, linked drawings, how often it was reopened, and an append-only change history.

alter table quality.inspections
  add column is_private boolean not null default false,
  add column distribution_ids uuid[] not null default '{}',
  add column drawing_revision_ids uuid[] not null default '{}',
  add column reopen_count int not null default 0;

create table quality.inspection_history (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  inspection_id  uuid not null references quality.inspections (id),
  kind           text not null check (kind in ('created', 'updated', 'section_na', 'signed', 'submitted', 'reopened', 'closed', 'deleted')),
  detail         jsonb not null default '{}',
  actor_id       uuid,
  at             timestamptz not null default now()
);
create index inspection_history_inspection on quality.inspection_history (org_id, inspection_id, at);
select kernel.enable_tenant_rls('quality.inspection_history');

create function quality.inspection_history_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'inspection history is append-only' using errcode = 'P0001';
end $$;
create trigger inspection_history_append_only before update or delete on quality.inspection_history
  for each row execute function quality.inspection_history_append_only();

select kernel.grant_module_schema('quality');
