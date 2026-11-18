-- Composed from modules/safety/db/migrations/20261108080000_safety_toolbox_talks.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- safety: toolbox talks. A topic library per project, talks held on site (TBT-0001), and an attendance grid with a
-- signature per row. Attendance is evidence that workers were consulted (compliance 04 §2 item 9). Retention period
-- for it is not set yet (needs Grace), so nothing is tagged for deletion.

create table safety.toolbox_topics (
  id                   uuid primary key,
  org_id               uuid not null,
  project_id           uuid not null,
  title                text not null check (length(title) between 1 and 200),
  talking_points       text not null default '' check (length(talking_points) <= 10000),
  category             text not null default 'general'
    check (category in ('general', 'hazard', 'plant', 'environment', 'wellbeing', 'incident_review', 'emergency')),
  hrcw_category        text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid,
  updated_by           uuid,
  version              int not null default 1
);
create index toolbox_topics_project on safety.toolbox_topics (org_id, project_id, is_active);
select kernel.enable_tenant_rls('safety.toolbox_topics');

create table safety.toolbox_talks (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  number           int not null,
  topic_id         uuid references safety.toolbox_topics (id),
  title            text not null check (length(title) between 1 and 200),
  held_at          timestamptz not null,
  location         text check (location is null or length(location) <= 200),
  presenter_name   text not null check (length(presenter_name) between 1 and 200),
  notes            text check (notes is null or length(notes) <= 5000),
  status           text not null default 'open' check (status in ('open', 'closed')),
  closed_at        timestamptz,
  closed_by        uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1,
  deleted_at       timestamptz
);
create unique index toolbox_talks_number on safety.toolbox_talks (project_id, number);
create index toolbox_talks_register on safety.toolbox_talks (org_id, project_id, held_at desc, id desc) where deleted_at is null;
create index toolbox_talks_topic on safety.toolbox_talks (org_id, topic_id) where deleted_at is null;
select kernel.enable_tenant_rls('safety.toolbox_talks');

create table safety.toolbox_attendees (
  id                 uuid primary key,
  org_id             uuid not null,
  project_id         uuid not null,
  talk_id            uuid not null references safety.toolbox_talks (id),
  person_name        text not null check (length(person_name) between 1 and 200),
  company_id         uuid,
  user_id            uuid,
  signed_at          timestamptz,
  signature_file_id  uuid,
  -- sha256 of the signature image, so a pasted copy of one signature on several rows can be seen (never decides anything)
  signature_sha256   text,
  signed_by          uuid,
  created_at         timestamptz not null default now(),
  created_by         uuid,
  check ((signed_at is null) = (signed_by is null))
);
create index toolbox_attendees_talk on safety.toolbox_attendees (org_id, talk_id);
create index toolbox_attendees_signature on safety.toolbox_attendees (org_id, project_id, signature_sha256) where signature_sha256 is not null;
create unique index toolbox_attendees_person on safety.toolbox_attendees (talk_id, lower(person_name), coalesce(company_id, '00000000-0000-0000-0000-000000000000'));
select kernel.enable_tenant_rls('safety.toolbox_attendees');

select kernel.grant_module_schema('safety');
