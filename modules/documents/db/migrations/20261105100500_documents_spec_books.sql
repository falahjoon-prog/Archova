-- documents: specification books and their sections (backend schema/documents-drawings-specs.md, DOC-US10).
-- A book is one issued spec PDF; a person splits it into sections by page range. Issuing a new book can supersede
-- an older one, so a section number resolves to the current book's section.

create table documents.spec_books (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  name          text not null check (length(name) between 1 and 200),
  issued_date   date,
  file_id       uuid,
  status        text not null default 'current' check (status in ('current', 'superseded')),
  superseded_by_id uuid references documents.spec_books (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  version       int not null default 1
);
create index spec_books_project on documents.spec_books (org_id, project_id, status);
select kernel.enable_tenant_rls('documents.spec_books');

create table documents.spec_sections (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  book_id        uuid not null references documents.spec_books (id),
  section_number text not null check (length(section_number) between 1 and 20),
  title          text not null check (length(title) between 1 and 300),
  division       text check (length(division) <= 100),
  page_from      int not null check (page_from >= 1),
  page_to        int not null,
  revision       text check (length(revision) <= 20),
  sort           int not null,
  search         tsvector generated always as (
    to_tsvector('english', coalesce(section_number, '') || ' ' || coalesce(title, ''))) stored,
  check (page_to >= page_from),
  unique (book_id, section_number)
);
create index spec_sections_book on documents.spec_sections (org_id, book_id, sort);
create index spec_sections_search on documents.spec_sections using gin (search);
select kernel.enable_tenant_rls('documents.spec_sections');

select kernel.grant_module_schema('documents');
