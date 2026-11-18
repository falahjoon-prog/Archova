-- platform (phase 1): the project directory and company contacts (docs/backend/schema/platform.md).
-- Members get the directory details a project admin keeps for them (phone, job title, trade); the sign-in profile is
-- never shown to other members. company_contacts holds people at a company who have no login, e.g. a supplier's
-- office line.

alter table platform.project_members add column phone text check (phone is null or length(phone) <= 50);
alter table platform.project_members add column job_title text check (job_title is null or length(job_title) <= 100);
alter table platform.project_members add column trade text check (trade is null or length(trade) <= 100);

create table platform.company_contacts (
  id          uuid primary key,
  org_id      uuid not null references platform.orgs (id),
  company_id  uuid not null references platform.companies (id),
  name        text not null check (length(name) between 1 and 200),
  email       citext check (email is null or length(email) <= 320),
  phone       text check (phone is null or length(phone) <= 50),
  job_title   text check (job_title is null or length(job_title) <= 100),
  notes       text check (notes is null or length(notes) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,
  version     int not null default 1,
  deleted_at  timestamptz
);
create index company_contacts_company on platform.company_contacts (org_id, company_id, id) where deleted_at is null;
select kernel.enable_tenant_rls('platform.company_contacts');

select kernel.grant_module_schema('platform');
