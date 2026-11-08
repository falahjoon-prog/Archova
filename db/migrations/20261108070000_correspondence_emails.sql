-- Composed from modules/correspondence/db/migrations/20261108070000_correspondence_emails.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Emails sent about a correspondence item to people on the project. The worker claims queued rows and sends them;
-- the mail carries the number, subject, the sender's note and a link, never the body of the item.
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
