-- projectplan: the project's lifecycle action plan (numbered phases, each a list of typed items with an outcome,
-- responsible parties, links to records already in the system, requests for attachments and photos, and hold points
-- that stop later items being completed until someone cleared them).

create schema if not exists projectplan;

create table projectplan.phases (
  id         uuid primary key,
  org_id     uuid not null,
  project_id uuid not null,
  position   int not null check (position >= 1),
  title      text not null check (length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  version    int not null default 1,
  deleted_at timestamptz
);
create index phases_project on projectplan.phases (org_id, project_id, position) where deleted_at is null;
select kernel.enable_tenant_rls('projectplan.phases');

create table projectplan.items (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  phase_id        uuid not null references projectplan.phases (id),
  position        int not null check (position >= 1),
  title           text not null check (length(title) between 1 and 300),
  -- What "done" means, e.g. 'No RECs', 'Acceptable per company guidelines'.
  outcome         text not null default '' check (length(outcome) <= 1000),
  item_types      text[] not null default '{}'
    check (item_types <@ array['document', 'checklist', 'inspection', 'meeting', 'signed_document', 'application', 'notification', 'hold_point']),
  due_date        date,
  status          text not null default 'not_started' check (status in ('not_started', 'in_progress', 'complete')),
  -- [{ kind: 'internal' | 'third_party', companyId, userIds, label, confirmed }]
  parties         jsonb not null default '[]',
  -- Standards and guidelines to read: [{ label, url, fileId }]
  reference_docs  jsonb not null default '[]',
  -- Records already in the system: [{ type, id, label }]
  links           jsonb not null default '[]',
  note            text,
  completed_at    timestamptz,
  completed_by    uuid,
  hold_cleared_at timestamptz,
  hold_cleared_by uuid,
  hold_note       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  version         int not null default 1,
  deleted_at      timestamptz
);
create index items_phase on projectplan.items (org_id, phase_id, position) where deleted_at is null;
create index items_project on projectplan.items (org_id, project_id) where deleted_at is null;
select kernel.enable_tenant_rls('projectplan.items');

create table projectplan.requests (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  item_id          uuid not null references projectplan.items (id),
  kind             text not null check (kind in ('attachment', 'photo')),
  message          text not null default '' check (length(message) <= 2000),
  assignee_user_id uuid,
  status           text not null default 'open' check (status in ('open', 'fulfilled', 'cancelled')),
  file_ids         uuid[] not null default '{}',
  requested_by     uuid,
  fulfilled_at     timestamptz,
  fulfilled_by     uuid,
  created_at       timestamptz not null default now()
);
create index requests_item on projectplan.requests (org_id, item_id);
select kernel.enable_tenant_rls('projectplan.requests');

select kernel.grant_module_schema('projectplan');
