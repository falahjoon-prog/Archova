-- quality: inspection header, section N/A, date items and N/A on any item; per-item activity on an inspection and the observations raised from an item (Procore parity gap check, 7 Nov).

alter table quality.inspection_template_items
  drop constraint inspection_template_items_response_type_check,
  add constraint inspection_template_items_response_type_check
    check (response_type in ('pass_fail_na', 'yes_no', 'number', 'text', 'photo', 'signature', 'select', 'date'));

-- The header on an inspection: due date, assignees, responsible contractor and point of contact. The inspection date
-- is scheduled_for. A section marked N/A counts all its items as N/A.
alter table quality.inspections
  add column due_date date,
  add column assignee_ids uuid[] not null default '{}',
  add column responsible_company_id uuid,
  add column point_of_contact_id uuid,
  add column na_sections text[] not null default '{}',
  add column trade text,
  add column spec_section text,
  add column description text not null default '',
  add column file_ids uuid[] not null default '{}';

-- Any number of signatures on an inspection (inspector, contractor representative, client), each with who and when.
create table quality.inspection_signatures (
  id             uuid primary key,
  org_id         uuid not null,
  inspection_id  uuid not null references quality.inspections (id),
  name           text not null check (length(name) between 1 and 200),
  file_id        uuid,
  signed_by      uuid,
  at             timestamptz not null default now()
);
create index inspection_signatures_inspection on quality.inspection_signatures (org_id, inspection_id, at);
select kernel.enable_tenant_rls('quality.inspection_signatures');

alter table quality.observations
  add column inspection_id uuid references quality.inspections (id),
  add column inspection_item_id uuid references quality.inspection_template_items (id);
alter table quality.observations
  add constraint observations_item_needs_inspection
    check (inspection_item_id is null or inspection_id is not null) not valid;

-- Append-only: one row per answer change, comment, file added or observation raised from a checklist item.
create table quality.inspection_item_events (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  inspection_id    uuid not null references quality.inspections (id),
  template_item_id uuid not null references quality.inspection_template_items (id),
  kind             text not null check (kind in ('response', 'comment', 'attachment', 'photo', 'observation')),
  body             text,
  result           text check (result in ('pass', 'fail', 'na')),
  file_ids         uuid[] not null default '{}',
  observation_id   uuid,
  actor_id         uuid,
  at               timestamptz not null default now()
);
create index inspection_item_events_item
  on quality.inspection_item_events (org_id, inspection_id, template_item_id, at);
select kernel.enable_tenant_rls('quality.inspection_item_events');

create function quality.inspection_item_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'inspection item events are append-only' using errcode = 'P0001';
end $$;
create trigger inspection_item_events_append_only before update or delete on quality.inspection_item_events
  for each row execute function quality.inspection_item_events_append_only();

alter table quality.inspection_template_items add column help_text text not null default '';

select kernel.grant_module_schema('quality');
