-- bim: site captures. A capture is a 360 tour (Matterport, Kuula, Ricoh Tours) someone embedded in the project by
-- pasting its share link, with the date it shows, where it is, and the RFI or coordination issue it relates to.
-- Archova stores the link, never the imagery.

create table bim.site_captures (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  title        text not null check (length(title) between 1 and 200),
  provider     text not null check (provider in ('matterport', 'kuula', 'ricoh')),
  url          text not null check (length(url) between 10 and 2000 and url like 'https://%'),
  captured_on  date not null,
  area         text not null default '' check (length(area) <= 200),
  note         text not null default '' check (length(note) <= 2000),
  rfi_id       uuid,
  issue_id     uuid references bim.issues (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  version      int not null default 1,
  deleted_at   timestamptz
);
create index site_captures_project on bim.site_captures (org_id, project_id, captured_on desc, created_at desc) where deleted_at is null;
select kernel.enable_tenant_rls('bim.site_captures');
grant select, insert, update on bim.site_captures to app_rw;
