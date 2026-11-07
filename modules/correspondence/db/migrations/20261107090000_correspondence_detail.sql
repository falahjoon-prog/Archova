-- Correspondence detail: a private flag with a per-item permissions list, type-specific fields, a change history and
-- a log of the emails sent about an item.

-- Fields a type asks for (for example a construction start date). An item keeps a copy of the definitions it was
-- created with, so changing the type later does not change what an old item means.
alter table correspondence.types add column field_defs jsonb not null default '[]';
alter table correspondence.items add column field_defs jsonb not null default '[]';
alter table correspondence.items add column fields jsonb not null default '{}';
alter table correspondence.items add column is_private bool not null default false;

-- Who may see a private item besides its author and the project's correspondence admins.
create table correspondence.item_access (
  item_id  uuid not null references correspondence.items (id),
  org_id   uuid not null,
  user_id  uuid not null,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
select kernel.enable_tenant_rls('correspondence.item_access');

-- What changed on an item, by whom and when. Written by the service in the same transaction as the change.
create table correspondence.item_history (
  id       uuid primary key,
  org_id   uuid not null,
  item_id  uuid not null references correspondence.items (id),
  at       timestamptz not null default now(),
  actor_id uuid,
  action   text not null,
  changes  jsonb not null default '[]'
);
create index item_history_item on correspondence.item_history (item_id, at);
select kernel.enable_tenant_rls('correspondence.item_history');

-- Emails sent about an item to people on the project. The worker claims queued rows and sends them; the mail
-- carries the number, subject, the sender's note and a link, never the body of the item.
create table correspondence.item_emails (
  id                uuid primary key,
  org_id            uuid not null,
  item_id           uuid not null references correspondence.items (id),
  sender_id         uuid not null,
  recipient_user_id uuid not null,
  message           text not null default '' check (length(message) <= 1000),
  status            text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts          int not null default 0,
  claimed_at        timestamptz,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);
create index item_emails_item on correspondence.item_emails (item_id, created_at);
create index item_emails_queue on correspondence.item_emails (org_id, status, created_at)
  where status in ('queued', 'sending');
select kernel.enable_tenant_rls('correspondence.item_emails');

select kernel.grant_module_schema('correspondence');
