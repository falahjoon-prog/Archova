-- Composed from modules/meetings/db/migrations/20261030140000_meetings.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- meetings: series, meetings, attendance, agenda sections, items (information, decision, action) and the frozen
-- issued versions (product/07-meetings.md, MTG-AC1..AC7).

create schema if not exists meetings;

create table meetings.series (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  name              text not null check (length(name) between 1 and 200),
  template          text not null default 'custom'
    check (template in ('site_coordination', 'pcg', 'design_coordination', 'safety_committee', 'custom')),
  cadence           text check (cadence is null or length(cadence) <= 100),
  -- [{ name, companyName, role, email, userId, companyId }]
  default_attendees jsonb not null default '[]',
  -- [{ title, internalOnly }]: the agenda the first meeting starts from (later ones start from the previous meeting).
  agenda            jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  updated_by        uuid,
  version           int not null default 1,
  deleted_at        timestamptz
);
create index series_project on meetings.series (org_id, project_id) where deleted_at is null;
select kernel.enable_tenant_rls('meetings.series');

create table meetings.meetings (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  series_id      uuid not null references meetings.series (id),
  number         int not null,
  title          text not null check (length(title) between 1 and 300),
  held_at        timestamptz not null,
  location       text not null default '',
  chair_user_id  uuid,
  status         text not null default 'draft' check (status in ('draft', 'issued')),
  corrections_by date,
  issued_version int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid,
  updated_by     uuid,
  version        int not null default 1,
  deleted_at     timestamptz
);
create unique index meetings_number on meetings.meetings (series_id, number);
create index meetings_project on meetings.meetings (org_id, project_id, held_at desc) where deleted_at is null;
select kernel.enable_tenant_rls('meetings.meetings');

create table meetings.attendees (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  meeting_id   uuid not null references meetings.meetings (id),
  position     int not null,
  name         text not null check (length(name) between 1 and 200),
  company_name text not null default '',
  role         text not null default '',
  email        text,
  user_id      uuid,
  company_id   uuid,
  attendance   text not null default 'present' check (attendance in ('present', 'apologies', 'absent')),
  created_at   timestamptz not null default now()
);
create index attendees_meeting on meetings.attendees (org_id, meeting_id, position);
select kernel.enable_tenant_rls('meetings.attendees');

create table meetings.sections (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  meeting_id    uuid not null references meetings.meetings (id),
  position      int not null check (position >= 1),
  title         text not null check (length(title) between 1 and 200),
  internal_only boolean not null default false,
  -- The next item number in this section. Carried forward so a closed item's number is never reused.
  next_item     int not null default 1,
  created_at    timestamptz not null default now()
);
create unique index sections_position on meetings.sections (meeting_id, position);
select kernel.enable_tenant_rls('meetings.sections');

create table meetings.items (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  meeting_id       uuid not null references meetings.meetings (id),
  section_id       uuid not null references meetings.sections (id),
  -- The item's first appearance; every carried copy shares it, so the history of "3.2" is one query.
  thread_id        uuid not null,
  carried_from_id  uuid,
  carried_count    int not null default 0,
  item_no          text not null,
  seq              int not null check (seq >= 1),
  kind             text not null check (kind in ('information', 'decision', 'action')),
  body             text not null check (length(body) between 1 and 5000),
  status           text not null default 'open' check (status in ('open', 'closed')),
  owner_company_id uuid,
  owner_user_id    uuid,
  owner_name       text,
  due_date         date,
  linked_type      text check (linked_type in ('rfi', 'variation', 'defect')),
  linked_id        text,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1,
  deleted_at       timestamptz,
  check ((linked_type is null) = (linked_id is null))
);
create unique index items_number on meetings.items (section_id, seq) where deleted_at is null;
create index items_meeting on meetings.items (org_id, meeting_id) where deleted_at is null;
create index items_thread on meetings.items (org_id, thread_id);
-- "My actions": open actions by owner (MTG-US9).
create index items_actions on meetings.items (org_id, project_id, owner_company_id, due_date)
  where deleted_at is null and kind = 'action' and status = 'open';
select kernel.enable_tenant_rls('meetings.items');

-- One row per issue; corrections create the next version and both remain (MTG-AC4). Append-only.
create table meetings.versions (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  meeting_id     uuid not null references meetings.meetings (id),
  version        int not null,
  issued_at      timestamptz not null default now(),
  issued_by      uuid,
  corrections_by date,
  note           text,
  -- [{ name, email }]: who the minutes went to.
  recipients     jsonb not null default '[]',
  -- The minutes as they stood, in the API's detail shape (internal-only sections included, hidden from outsiders).
  snapshot       jsonb not null,
  unique (meeting_id, version)
);
select kernel.enable_tenant_rls('meetings.versions');

create function meetings.versions_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'issued minutes are append-only' using errcode = 'P0001';
end $$;
create trigger versions_append_only before update or delete on meetings.versions
  for each row execute function meetings.versions_append_only();

select kernel.grant_module_schema('meetings');
