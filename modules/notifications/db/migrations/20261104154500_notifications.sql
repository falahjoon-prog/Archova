-- notifications: the in-app inbox (backend 05 §1, schema/shared.md). One row per person per thing to tell them;
-- `dedupe_key` makes a scheduled reminder safe to run twice. Read by its recipient only (enforced in the use case).

create schema if not exists notifications;

create table notifications.notifications (
  id          uuid primary key,
  org_id      uuid not null,
  user_id     uuid not null,
  project_id  uuid,
  -- e.g. 'meeting.action_due_soon', 'meeting.action_overdue'
  kind        text not null check (length(kind) between 1 and 100),
  entity_type text not null check (entity_type in ('meeting')),
  entity_id   uuid not null,
  title       text not null check (length(title) between 1 and 300),
  body        text not null default '' check (length(body) <= 2000),
  dedupe_key  text not null check (length(dedupe_key) between 1 and 300),
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_inbox on notifications.notifications (org_id, user_id, created_at desc);
create index notifications_unread on notifications.notifications (org_id, user_id) where read_at is null;
select kernel.enable_tenant_rls('notifications.notifications');

select kernel.grant_module_schema('notifications');
