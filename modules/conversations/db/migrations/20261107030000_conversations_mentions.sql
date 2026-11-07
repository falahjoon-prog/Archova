-- Who a message mentions (people on the project team). Used to notify them; the text itself keeps the @Name.
alter table conversations.messages add column mentions uuid[] not null default '{}';
