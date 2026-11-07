-- Composed from modules/conversations/db/migrations/20261107030000_conversations_mentions.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Who a message mentions (people on the project team). Used to notify them; the text itself keeps the @Name.
alter table conversations.messages add column mentions uuid[] not null default '{}';
