-- Composed from modules/submittals/db/migrations/20261030100000_submittals.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- submittals: the register of shop drawings, product data and samples, and their review path
-- (backend schema/rfis-submittals-correspondence.md §submittals, product/04).

create schema if not exists submittals;

create table submittals.submittals (
  id                     uuid primary key,
  org_id                 uuid not null,
  project_id             uuid not null,
  number                 int not null,
  number_label           text not null check (length(number_label) between 1 and 40),
  title                  text not null check (length(title) between 1 and 300),
  type                   text not null default 'shop_drawing'
    check (type in ('shop_drawing', 'product_data', 'sample', 'mock_up', 'certificate', 'other')),
  spec_section           text,
  responsible_company_id uuid,
  manager_id             uuid,
  required_on_site       date,
  lead_time_days         int not null default 0 check (lead_time_days between 0 and 1000),
  review_days            int not null default 10 check (review_days between 0 and 250),
  submit_by              date,
  status                 text not null default 'draft'
    check (status in ('draft', 'submitted', 'in_review', 'approved', 'approved_as_noted',
                      'revise_resubmit', 'rejected', 'closed')),
  current_revision       int not null default 0,
  submitted_at           timestamptz,
  returned_at            timestamptz,
  closed_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid,
  updated_by             uuid,
  version                int not null default 1,
  deleted_at             timestamptz
);
create unique index submittals_number on submittals.submittals (project_id, number);
create unique index submittals_label on submittals.submittals (project_id, number_label) where deleted_at is null;
create index submittals_register on submittals.submittals (org_id, project_id, status, submit_by) where deleted_at is null;
select kernel.enable_tenant_rls('submittals.submittals');

create table submittals.revisions (
  id                 uuid primary key,
  org_id             uuid not null,
  submittal_id       uuid not null references submittals.submittals (id),
  revision           int not null,
  submitted_by       uuid,
  submitted_by_company_id uuid,
  submitted_at       timestamptz not null default now(),
  note               text not null default '',
  file_ids           uuid[] not null default '{}',
  status             text not null default 'in_review'
    check (status in ('in_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected')),
  returned_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (submittal_id, revision)
);
select kernel.enable_tenant_rls('submittals.revisions');

create table submittals.steps (
  id               uuid primary key,
  org_id           uuid not null,
  submittal_id     uuid not null references submittals.submittals (id),
  revision_id      uuid not null references submittals.revisions (id),
  step             int not null check (step >= 1),
  kind             text not null check (kind in ('builder', 'consultant')),
  approver_user_id uuid not null,
  company_id       uuid,
  due_date         date,
  response         text not null default 'pending'
    check (response in ('pending', 'forwarded', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected', 'skipped')),
  comments         text not null default '',
  file_ids         uuid[] not null default '{}',
  responded_at     timestamptz,
  responded_by     uuid,
  created_at       timestamptz not null default now(),
  unique (revision_id, step)
);
create index steps_approver on submittals.steps (org_id, approver_user_id) where response = 'pending';
select kernel.enable_tenant_rls('submittals.steps');

select kernel.grant_module_schema('submittals');
