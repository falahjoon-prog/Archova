-- conversations: project-level message threads for the Project home card. Internal team only (the application layer
-- refuses outside users); a thread is a subject plus an ordered list of messages.

create schema if not exists conversations;

create table conversations.threads (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  subject          text not null check (length(subject) between 1 and 200),
  message_count    int not null default 1 check (message_count >= 1),
  last_message_at  timestamptz not null,
  created_at       timestamptz not null default now(),
  created_by       uuid not null
);
create index threads_recent on conversations.threads (project_id, last_message_at desc, id desc);
select kernel.enable_tenant_rls('conversations.threads');

create table conversations.messages (
  id         uuid primary key,
  org_id     uuid not null,
  thread_id  uuid not null references conversations.threads (id),
  project_id uuid not null,
  author_id  uuid not null,
  body       text not null check (length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index messages_thread on conversations.messages (thread_id, created_at, id);
select kernel.enable_tenant_rls('conversations.messages');

select kernel.grant_module_schema('conversations');
