-- announcements: a project-wide broadcast to everyone on the project or a chosen group, with a read receipt per
-- person. Recipients are fixed when the announcement is posted (people added later are not retro-notified).
-- `read_by_hours` is the author's "should have been read by" window; Nova flags key people past it, and the
-- author confirms before any nudge is sent.

create schema if not exists announcements;

create table announcements.announcements (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  title                 text not null check (length(title) between 1 and 200),
  body                  text not null check (length(body) between 1 and 5000),
  priority              text not null default 'normal' check (priority in ('normal', 'important')),
  audience_kind         text not null check (audience_kind in ('all', 'group')),
  audience_company_ids  uuid[] not null default '{}',
  audience_user_ids     uuid[] not null default '{}',
  read_by_hours         int check (read_by_hours between 1 and 720),
  created_by            uuid not null,
  created_at            timestamptz not null default now()
);
create index announcements_recent on announcements.announcements (project_id, created_at desc, id desc);
select kernel.enable_tenant_rls('announcements.announcements');

create table announcements.recipients (
  id               uuid primary key,
  org_id           uuid not null,
  announcement_id  uuid not null references announcements.announcements (id),
  project_id       uuid not null,
  user_id          uuid not null,
  is_key           boolean not null default false,
  read_at          timestamptz,
  nudged_at        timestamptz,
  nudge_count      int not null default 0,
  unique (announcement_id, user_id)
);
create index recipients_unread on announcements.recipients (org_id, user_id, project_id) where read_at is null;
create index recipients_by_announcement on announcements.recipients (announcement_id);
select kernel.enable_tenant_rls('announcements.recipients');

select kernel.grant_module_schema('announcements');
