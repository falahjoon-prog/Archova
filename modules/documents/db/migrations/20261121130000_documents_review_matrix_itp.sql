-- documents: review matrix (who reviews/approves a document, in what order), threaded comments with a
-- resolution status, and ITP (inspection and test plan) packages tied to a document.

-- One review round on one revision of a document. Only one round is open per document at a time.
create table documents.document_reviews (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  document_id uuid not null references documents.documents (id),
  revision_id uuid not null references documents.document_revisions (id),
  mode        text not null check (mode in ('sequential', 'parallel')),
  status      text not null default 'open' check (status in ('open', 'approved', 'rejected', 'cancelled')),
  due_at      timestamptz,
  note        text,
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1
);
create unique index document_reviews_one_open on documents.document_reviews (document_id) where status = 'open';
create index document_reviews_project on documents.document_reviews (org_id, project_id, status, due_at);
select kernel.enable_tenant_rls('documents.document_reviews');

-- The matrix rows. Steps with the same `step_order` run together; a later order waits for the earlier ones.
create table documents.document_review_steps (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  review_id     uuid not null references documents.document_reviews (id),
  document_id   uuid not null references documents.documents (id),
  user_id       uuid not null,
  role          text not null check (role in ('reviewer', 'approver')),
  step_order    int not null check (step_order between 1 and 50),
  status        text not null default 'waiting'
    check (status in ('waiting', 'pending', 'approved', 'approved_with_comments', 'rejected', 'skipped')),
  activated_at  timestamptz,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       int not null default 1,
  unique (review_id, user_id)
);
create index document_review_steps_review on documents.document_review_steps (org_id, review_id, step_order);
create index document_review_steps_user on documents.document_review_steps (org_id, project_id, user_id, status);
select kernel.enable_tenant_rls('documents.document_review_steps');

-- Threaded comments. A reply has a `parent_id`; the open/resolved status lives on the thread's first comment.
create table documents.document_comments (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  document_id     uuid not null references documents.documents (id),
  revision_id     uuid references documents.document_revisions (id),
  parent_id       uuid references documents.document_comments (id),
  body            text not null check (length(body) between 1 and 4000),
  page            int check (page >= 1),
  status          text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by     uuid,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  version         int not null default 1
);
create index document_comments_doc on documents.document_comments (org_id, document_id, created_at);
select kernel.enable_tenant_rls('documents.document_comments');

-- An ITP package: the hold, witness and surveillance points for one piece of work, optionally tied to the
-- document (drawing or spec) the work is built against.
create table documents.itp_packages (
  id                     uuid primary key,
  org_id                 uuid not null,
  project_id             uuid not null,
  number                 text not null,
  name                   text not null check (length(name) between 1 and 200),
  discipline             text,
  document_id            uuid references documents.documents (id),
  responsible_company_id uuid,
  status                 text not null default 'draft' check (status in ('draft', 'active', 'complete')),
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  updated_by             uuid,
  version                int not null default 1
);
create unique index itp_packages_number on documents.itp_packages (org_id, project_id, number);
create index itp_packages_project on documents.itp_packages (org_id, project_id, status);
select kernel.enable_tenant_rls('documents.itp_packages');

create table documents.itp_items (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  package_id          uuid not null references documents.itp_packages (id),
  sort                int not null check (sort >= 1),
  description         text not null check (length(description) between 1 and 500),
  acceptance_criteria text,
  point_type          text not null check (point_type in ('hold', 'witness', 'surveillance')),
  status              text not null default 'pending' check (status in ('pending', 'passed', 'failed', 'waived')),
  signed_by           uuid,
  signed_at           timestamptz,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int not null default 1,
  unique (package_id, sort)
);
create index itp_items_package on documents.itp_items (org_id, package_id, sort);
select kernel.enable_tenant_rls('documents.itp_items');
select kernel.grant_module_schema('documents');
