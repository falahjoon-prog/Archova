-- declarations: the project register of subcontractor statutory declarations (workers' compensation currency, payroll
-- tax and wages/remuneration) a builder collects with each payment claim. The register records what was received and the
-- period it covers; whether a claim may be paid is worked out from it, never stored. Documents stay in `files`.

create schema if not exists declarations;

create table declarations.statements (
  id                 uuid primary key,
  org_id             uuid not null,
  project_id         uuid not null,
  number             int not null,
  company_id         uuid not null,
  kind               text not null check (kind in ('workers_comp', 'payroll_tax', 'wages')),
  declarant_name     text check (length(declarant_name) <= 200),
  declarant_position text check (length(declarant_position) <= 200),
  declared_on        date,
  -- The declaration covers payment claims whose period ends on or between these dates. For workers' compensation this
  -- is the policy period; for payroll tax and wages it is the period the declaration speaks for.
  valid_from         date not null,
  valid_to           date not null,
  -- Workers' compensation: the insurer. Otherwise the registration or reference the declaration quotes.
  issuer             text check (length(issuer) <= 200),
  reference_number   text check (length(reference_number) <= 100),
  -- Set when the declaration was given for one specific payment claim (it then counts for that claim whatever the dates).
  claim_id           uuid,
  lifecycle          text not null default 'accepted' check (lifecycle in ('accepted', 'rejected')),
  notes              text check (length(notes) <= 4000),
  file_ids           uuid[] not null default '{}',
  -- Set when the fields were first read from the certificate by Nova and then confirmed by a person.
  read_by_nova       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  version            int not null default 1,
  deleted_at         timestamptz,
  check (cardinality(file_ids) <= 6),
  check (valid_from <= valid_to)
);
create unique index statements_number on declarations.statements (project_id, number);
create index statements_register on declarations.statements (org_id, project_id, lifecycle, valid_to) where deleted_at is null;
create index statements_company on declarations.statements (org_id, project_id, company_id) where deleted_at is null;
select kernel.enable_tenant_rls('declarations.statements');

-- What every subcontractor claim on the project needs. Empty until set, and while empty nothing is ever blocked.
create table declarations.requirements (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  kind        text not null check (kind in ('workers_comp', 'payroll_tax', 'wages')),
  lead_days   int not null default 30 check (lead_days between 0 and 365),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (project_id, kind)
);
create index requirements_project on declarations.requirements (org_id, project_id);
select kernel.enable_tenant_rls('declarations.requirements');

create table declarations.statement_events (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  statement_id uuid not null references declarations.statements (id),
  action       text not null,
  from_lifecycle text,
  to_lifecycle text not null,
  valid_to     date,
  note         text,
  actor_id     uuid,
  at           timestamptz not null default now()
);
create index statement_events_statement on declarations.statement_events (org_id, statement_id, at);
select kernel.enable_tenant_rls('declarations.statement_events');

create function declarations.statement_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'declaration events are append-only' using errcode = 'P0001';
end $$;
create trigger statement_events_append_only before update or delete on declarations.statement_events
  for each row execute function declarations.statement_events_append_only();

-- A payment schedule issued for money while a required declaration was missing: who went ahead, and why. Append-only.
-- Archova never stops a schedule being issued in time (a late one can make the claim payable in full), so this is an
-- acknowledgement on the record, not a refusal.
create table declarations.overrides (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  claim_id    uuid not null,
  company_id  uuid not null,
  issues      text[] not null,
  reason      text not null check (length(reason) between 3 and 2000),
  actor_id    uuid,
  at          timestamptz not null default now()
);
create index overrides_claim on declarations.overrides (org_id, claim_id);
select kernel.enable_tenant_rls('declarations.overrides');
create function declarations.overrides_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'declaration overrides are append-only' using errcode = 'P0001';
end $$;
create trigger overrides_append_only before update or delete on declarations.overrides
  for each row execute function declarations.overrides_append_only();

-- Every chase sent to a subcontractor for missing declarations.
create table declarations.chases (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  company_id  uuid not null,
  claim_id    uuid,
  kinds       text[] not null,
  channel     text not null default 'email' check (channel in ('email')),
  recipient   text not null,
  subject     text not null,
  body        text not null,
  sent_by     uuid,
  sent_at     timestamptz not null default now()
);
create index chases_company on declarations.chases (org_id, project_id, company_id, sent_at);
select kernel.enable_tenant_rls('declarations.chases');

select kernel.grant_module_schema('declarations');
