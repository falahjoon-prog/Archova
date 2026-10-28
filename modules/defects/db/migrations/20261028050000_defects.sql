-- defects: the defect register and its status history (backend schema/field.md §defects, product/06).

create schema if not exists defects;

create table defects.defects (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  number                int not null,
  title                 text not null check (length(title) between 1 and 300),
  description           text not null default '',
  status                text not null default 'draft'
    check (status in ('draft', 'open', 'ready_for_review', 'closed', 'disputed', 'void')),
  priority              text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  category              text,
  trade                 text,
  stage                 text not null default 'pre_pc' check (stage in ('pre_pc', 'pc', 'dlp')),
  location_id           uuid,
  sheet_id              uuid,
  drawing_revision_id   uuid,
  pin_x                 real check (pin_x between 0 and 1),
  pin_y                 real check (pin_y between 0 and 1),
  assignee_company_id   uuid,
  assignee_user_id      uuid,
  due_date              date,
  raised_by_company_id  uuid,
  issued_at             timestamptz,
  ready_for_review_at   timestamptz,
  closed_at             timestamptz,
  closed_by             uuid,
  source                text not null default 'manual' check (source in ('manual', 'inspection', 'ai_suggested')),
  inspection_item_id    uuid,
  search                tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))) stored,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  version               int not null default 1,
  deleted_at            timestamptz,
  check ((pin_x is null) = (pin_y is null)),
  check (pin_x is null or drawing_revision_id is not null),
  -- DEF-AC3: a pin or a location, from the moment it is created
  check (location_id is not null or pin_x is not null),
  -- an issued defect always has a company to fix it
  check (status in ('draft', 'void') or assignee_company_id is not null)
);
create unique index defects_number on defects.defects (project_id, number);
create index defects_register on defects.defects (org_id, project_id, status, assignee_company_id)
  where deleted_at is null;
create index defects_due on defects.defects (org_id, project_id, due_date)
  where deleted_at is null and status in ('open', 'disputed');
create index defects_drawing on defects.defects (org_id, drawing_revision_id)
  where drawing_revision_id is not null;
create index defects_search on defects.defects using gin (search);
select kernel.enable_tenant_rls('defects.defects');

-- Append-only: one row per status change, with the evidence photos (DEF lifecycle).
create table defects.events (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  defect_id   uuid not null references defects.defects (id),
  action      text not null,
  from_status text,
  to_status   text not null,
  note        text,
  file_ids    uuid[] not null default '{}',
  actor_id    uuid,
  at          timestamptz not null default now()
);
create index events_defect on defects.events (org_id, defect_id, at);
select kernel.enable_tenant_rls('defects.events');

create function defects.events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'defect events are append-only' using errcode = 'P0001';
end $$;
create trigger events_append_only before update or delete on defects.events
  for each row execute function defects.events_append_only();

select kernel.grant_module_schema('defects');
