-- Composed from modules/documents/db/migrations/20261002100000_documents.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- documents: folders, documents, drawing register, markups and transmittals
-- (backend schema/documents-drawings-specs.md, product/02). Sheet geometry arrives with the estimating
-- subset (X30); hyperlinks, pins, tiles and spec books with the files worker and AI title-block reading.

create schema if not exists documents;

create table documents.folders (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  parent_id           uuid references documents.folders (id),
  name                text not null check (length(name) between 1 and 200),
  is_private          boolean not null default false,
  allowed_user_ids    uuid[] not null default '{}',
  allowed_company_ids uuid[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1,
  deleted_at          timestamptz
);
create unique index folders_name on documents.folders (org_id, project_id, parent_id, name) nulls not distinct
  where deleted_at is null;
create index folders_parent on documents.folders (org_id, project_id, parent_id);
select kernel.enable_tenant_rls('documents.folders');

create table documents.documents (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  folder_id           uuid not null references documents.folders (id),
  title               text not null check (length(title) between 1 and 300),
  doc_number          text,
  discipline          text,
  doc_type            text,
  current_revision_id uuid,
  status              text not null default 'draft'
    check (status in ('draft', 'for_review', 'approved', 'for_construction', 'superseded', 'void')),
  custom              jsonb not null default '{}',
  search              tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(doc_number, ''))) stored,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1,
  deleted_at          timestamptz
);
create unique index documents_number on documents.documents (org_id, project_id, doc_number)
  where doc_number is not null and deleted_at is null;
create index documents_folder on documents.documents (org_id, project_id, folder_id) where deleted_at is null;
create index documents_search on documents.documents using gin (search);
select kernel.enable_tenant_rls('documents.documents');

create table documents.document_revisions (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  document_id   uuid not null references documents.documents (id),
  rev           text not null check (length(rev) between 1 and 20),
  file_id       uuid not null,
  status        text not null check (status in ('current', 'superseded')),
  issued_for    text,
  issued_date   date,
  notes         text,
  superseded_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  version       int not null default 1,
  unique (document_id, rev)
);
create unique index document_revisions_current on documents.document_revisions (document_id)
  where status = 'current';
create index document_revisions_doc on documents.document_revisions (org_id, document_id);
select kernel.enable_tenant_rls('documents.document_revisions');

-- An issue batch ("IFC Set 3"). `processing` is for the files worker's split and title-block reading.
create table documents.drawing_sets (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  name          text not null check (length(name) between 1 and 200),
  issued_date   date,
  received_date date,
  status        text not null default 'review' check (status in ('processing', 'review', 'published')),
  published_at  timestamptz,
  published_by  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  version       int not null default 1
);
create index drawing_sets_project on documents.drawing_sets (org_id, project_id, created_at desc);
select kernel.enable_tenant_rls('documents.drawing_sets');

-- The logical drawing: the sheet number persists across revisions.
create table documents.drawing_sheets (
  id                  uuid primary key,
  org_id              uuid not null,
  project_id          uuid not null,
  sheet_number        text not null check (length(sheet_number) between 1 and 50),
  title               text not null,
  discipline          text,
  area                text,
  current_revision_id uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid,
  updated_by          uuid,
  version             int not null default 1,
  unique (project_id, sheet_number)
);
create index drawing_sheets_project on documents.drawing_sheets (org_id, project_id, discipline, sheet_number);
select kernel.enable_tenant_rls('documents.drawing_sheets');

-- Draft rows hold what the title block says until the set is published; publishing resolves `sheet_id`.
create table documents.drawing_revisions (
  id               uuid primary key,
  org_id           uuid not null,
  project_id       uuid not null,
  set_id           uuid not null references documents.drawing_sets (id),
  sheet_id         uuid references documents.drawing_sheets (id),
  sheet_number     text not null check (length(sheet_number) between 1 and 50),
  title            text not null,
  discipline       text,
  rev              text not null check (length(rev) between 1 and 20),
  issued_for       text check (issued_for in ('preliminary', 'for_tender', 'for_approval', 'for_construction')),
  file_id          uuid not null,
  page_index       int not null default 0 check (page_index >= 0),
  status           text not null default 'draft' check (status in ('draft', 'current', 'superseded')),
  drawing_date     date,
  publish_reason   text,
  published_at     timestamptz,
  superseded_at    timestamptz,
  superseded_by_id uuid references documents.drawing_revisions (id),
  ocr_sheet_number text,
  ocr_title        text,
  ocr_confidence   real,
  tiles_prefix     text,
  width_px         int,
  height_px        int,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  version          int not null default 1,
  check (status = 'draft' or sheet_id is not null)
);
create unique index drawing_revisions_current on documents.drawing_revisions (sheet_id) where status = 'current';
create unique index drawing_revisions_rev on documents.drawing_revisions (sheet_id, rev) where status <> 'draft';
create index drawing_revisions_set on documents.drawing_revisions (org_id, set_id);
create index drawing_revisions_sheet on documents.drawing_revisions (org_id, sheet_id, published_at desc);
select kernel.enable_tenant_rls('documents.drawing_revisions');

-- Visibility per X12. Published (`project`) markups are part of the record and no longer editable.
create table documents.drawing_markups (
  id                    uuid primary key,
  org_id                uuid not null,
  project_id            uuid not null,
  revision_id           uuid not null references documents.drawing_revisions (id),
  owner_id              uuid not null,
  owner_company_id      uuid,
  visibility            text not null check (visibility in ('private', 'company', 'project')),
  shapes                jsonb not null default '[]',
  copied_from_id        uuid references documents.drawing_markups (id),
  needs_location_check  boolean not null default false,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid,
  updated_by            uuid,
  version               int not null default 1,
  deleted_at            timestamptz,
  check (visibility <> 'company' or owner_company_id is not null)
);
create index drawing_markups_revision on documents.drawing_markups (org_id, revision_id) where deleted_at is null;
select kernel.enable_tenant_rls('documents.drawing_markups');

create table documents.transmittals (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  number          int,
  subject         text not null check (length(subject) between 1 and 300),
  purpose         text not null
    check (purpose in ('for_information', 'for_review', 'for_construction', 'for_tender', 'other')),
  from_company_id uuid,
  sent_at         timestamptz,
  sent_by         uuid,
  response_due    date,
  message         text,
  status          text not null default 'draft' check (status in ('draft', 'sent')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  updated_by      uuid,
  version         int not null default 1,
  deleted_at      timestamptz,
  check (status = 'draft' or (number is not null and sent_at is not null))
);
create unique index transmittals_number on documents.transmittals (project_id, number) where number is not null;
create index transmittals_project on documents.transmittals (org_id, project_id, created_at desc)
  where deleted_at is null;
select kernel.enable_tenant_rls('documents.transmittals');

create table documents.transmittal_items (
  id             uuid primary key,
  org_id         uuid not null,
  transmittal_id uuid not null references documents.transmittals (id),
  revision_type  text not null check (revision_type in ('document', 'drawing')),
  revision_id    uuid not null,
  created_at     timestamptz not null default now(),
  unique (transmittal_id, revision_type, revision_id)
);
create index transmittal_items_t on documents.transmittal_items (org_id, transmittal_id);
select kernel.enable_tenant_rls('documents.transmittal_items');

create table documents.transmittal_recipients (
  id              uuid primary key,
  org_id          uuid not null,
  transmittal_id  uuid not null references documents.transmittals (id),
  user_id         uuid,
  company_id      uuid,
  email           citext not null,
  name            text,
  role            text not null default 'to' check (role in ('to', 'cc')),
  delivered_at    timestamptz,
  opened_at       timestamptz,
  downloaded_at   timestamptz,
  acknowledged_at timestamptz,
  access_link_id  uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (transmittal_id, email)
);
create index transmittal_recipients_user on documents.transmittal_recipients (org_id, user_id);
select kernel.enable_tenant_rls('documents.transmittal_recipients');

-- A sent transmittal is evidence (DOC-AC10): its header and items can't change. Recipient receipts still record.
create or replace function documents.freeze_sent_transmittal() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'transmittals' then
    if old.status = 'sent' then
      raise exception 'transmittal % is sent and immutable', old.id using errcode = 'check_violation';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (
    select 1 from documents.transmittals t
    where t.id = coalesce(new.transmittal_id, old.transmittal_id) and t.status = 'sent'
  ) then
    raise exception 'transmittal is sent and immutable' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger freeze_sent before update or delete on documents.transmittals
  for each row execute function documents.freeze_sent_transmittal();
create trigger freeze_sent before insert or update or delete on documents.transmittal_items
  for each row execute function documents.freeze_sent_transmittal();

select kernel.grant_module_schema('documents');
