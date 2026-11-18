-- handover: the project handover and close-out pack. One checklist per project of what the client is owed at
-- completion (as-builts, O&M manuals, warranties, certificates, defect sign-off, keys). Files live in `files`; this
-- module records what was asked for, supplied, approved, and what was issued to the client and when.

create schema if not exists handover;

create table handover.items (
  id                      uuid primary key,
  org_id                  uuid not null,
  project_id              uuid not null,
  number                  int not null,
  category                text not null check (category in (
                            'as_built', 'om_manual', 'warranty', 'certificate', 'defect_signoff', 'training',
                            'keys_access', 'other')),
  title                   text not null check (length(title) between 1 and 300),
  description             text check (length(description) <= 4000),
  required                boolean not null default true,
  status                  text not null default 'outstanding' check (status in (
                            'outstanding', 'requested', 'received', 'approved', 'not_applicable')),
  responsible_company_id  uuid,
  due_on                  date,
  received_on             date,
  approved_on             date,
  approved_by             uuid,
  note                    text check (length(note) <= 4000),
  file_ids                uuid[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  updated_by              uuid,
  version                 int not null default 1,
  deleted_at              timestamptz,
  check (cardinality(file_ids) <= 10),
  check (status <> 'approved' or approved_on is not null)
);
create unique index handover_items_number on handover.items (project_id, number);
create index handover_items_register on handover.items (org_id, project_id, category, status) where deleted_at is null;
select kernel.enable_tenant_rls('handover.items');

create table handover.item_events (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  item_id      uuid not null references handover.items (id),
  action       text not null,
  from_status  text,
  to_status    text not null,
  note         text,
  actor_id     uuid,
  at           timestamptz not null default now()
);
create index handover_item_events_item on handover.item_events (org_id, item_id, at);
select kernel.enable_tenant_rls('handover.item_events');

-- What was handed to the client and when: a frozen copy of the checklist at that moment. Never edited.
create table handover.issues (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  recipient_name   text not null check (length(recipient_name) between 1 and 200),
  note             text check (length(note) <= 2000),
  incomplete_count int not null default 0,
  snapshot         jsonb not null,
  issued_by        uuid,
  issued_at        timestamptz not null default now()
);
create index handover_issues_project on handover.issues (org_id, project_id, issued_at desc);
select kernel.enable_tenant_rls('handover.issues');

create function handover.append_only() returns trigger language plpgsql as $$
begin
  raise exception 'handover history is append-only' using errcode = 'P0001';
end $$;
create trigger item_events_append_only before update or delete on handover.item_events
  for each row execute function handover.append_only();
create trigger issues_append_only before update or delete on handover.issues
  for each row execute function handover.append_only();

select kernel.grant_module_schema('handover');
