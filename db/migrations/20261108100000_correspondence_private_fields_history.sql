-- Composed from modules/correspondence/db/migrations/20261108100000_correspondence_private_fields_history.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- correspondence: a private flag with a who-can-see list, type-specific fields, and a change history.

-- Extra fields a type asks for (for example a Construction Start Date): [{key, label, kind, required}], at most 12.
alter table correspondence.types
  add column fields jsonb not null default '[]' check (jsonb_typeof(fields) = 'array');

-- A private item is seen only by its author, admins and the people listed in item_access.
alter table correspondence.items
  add column is_private   bool not null default false,
  add column field_values jsonb not null default '{}' check (jsonb_typeof(field_values) = 'object');

create table correspondence.item_access (
  item_id  uuid not null references correspondence.items (id),
  org_id   uuid not null,
  user_id  uuid not null,
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index item_access_user on correspondence.item_access (org_id, user_id);
select kernel.enable_tenant_rls('correspondence.item_access');
grant select, insert, update, delete on correspondence.item_access to app_rw;

-- Append-only: who did what to an item and when. `changes` is [{field, from, to}] for edits.
create table correspondence.item_history (
  id      uuid primary key,
  org_id  uuid not null,
  item_id uuid not null references correspondence.items (id),
  at      timestamptz not null default now(),
  by_user uuid,
  action  text not null,
  changes jsonb not null default '[]' check (jsonb_typeof(changes) = 'array')
);
create index item_history_item on correspondence.item_history (item_id, at);
select kernel.enable_tenant_rls('correspondence.item_history');
grant select, insert on correspondence.item_history to app_rw;
