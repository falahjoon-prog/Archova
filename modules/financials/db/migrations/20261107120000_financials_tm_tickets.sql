-- financials: time-and-materials (daywork) tickets. A ticket records labour, equipment and material used on site
-- for work not in the contract, is signed on site by the contractor and the principal's representative, and is then
-- converted once into direct costs (cost to us) or a draft variation (a charge, claimable once approved).
-- Lines and details are frozen from the first signature; each signature stores a hash of what was signed.
-- `esign_request_id` is reserved for the e-signature flow; until it lands, a signature is a named, timestamped,
-- hashed attestation by a signed-in user holding the sign permission. Amounts are ex GST. Financial records: 7 years.

create table financials.tm_tickets (
  id              uuid primary key,
  org_id          uuid not null,
  project_id      uuid not null,
  number          int not null,
  title           text not null check (length(title) between 1 and 300),
  description     text check (description is null or length(description) <= 5000),
  work_date       date not null,
  location        text check (location is null or length(location) between 1 and 200),
  contractor      text check (contractor is null or length(contractor) between 1 and 200),
  instructed_by   text check (instructed_by is null or length(instructed_by) between 1 and 200),
  origin          text not null default 'manual' check (origin in ('manual', 'nova')),
  status          text not null default 'draft' check (status in ('draft', 'part_signed', 'signed', 'converted', 'void')),
  total           numeric(18,2) not null default 0 check (total >= 0),
  converted_to    text check (converted_to in ('direct_cost', 'variation')),
  converted_at    timestamptz,
  converted_by    uuid,
  variation_id    uuid references financials.variations (id),
  void_reason     text,
  voided_at       timestamptz,
  voided_by       uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  version         int not null default 1,
  unique (project_id, number),
  check ((status = 'converted') = (converted_to is not null)),
  check ((status = 'void') = (voided_at is not null)),
  check (status <> 'void' or void_reason is not null)
);
create index tm_tickets_project on financials.tm_tickets (org_id, project_id, number);
select kernel.enable_tenant_rls('financials.tm_tickets');
select kernel.enable_retention_guard('financials.tm_tickets');

create table financials.tm_ticket_lines (
  id           uuid primary key,
  org_id       uuid not null,
  project_id   uuid not null,
  ticket_id    uuid not null references financials.tm_tickets (id),
  sort         int not null,
  kind         text not null check (kind in ('labour', 'equipment', 'material')),
  description  text not null check (length(description) between 1 and 300),
  quantity     numeric(10,2) not null check (quantity > 0),
  unit         text not null check (length(unit) between 1 and 20),
  rate         numeric(18,2) not null check (rate >= 0),
  amount       numeric(18,2) not null check (amount >= 0),
  source_type  text check (source_type in ('timesheet_line', 'equipment_log')),
  source_id    uuid,
  check ((source_type is null) = (source_id is null))
);
create index tm_ticket_lines_ticket on financials.tm_ticket_lines (org_id, ticket_id, sort);
create index tm_ticket_lines_source on financials.tm_ticket_lines (org_id, project_id, source_type, source_id);
select kernel.enable_tenant_rls('financials.tm_ticket_lines');

create table financials.tm_ticket_signoffs (
  id                uuid primary key,
  org_id            uuid not null,
  project_id        uuid not null,
  ticket_id         uuid not null references financials.tm_tickets (id),
  role              text not null check (role in ('contractor', 'principal_rep')),
  signer_name       text not null check (length(signer_name) between 1 and 200),
  signer_position   text check (signer_position is null or length(signer_position) between 1 and 200),
  signed_by         uuid not null,
  content_hash      text not null check (length(content_hash) = 64),
  esign_request_id  uuid,
  signed_at         timestamptz not null default now(),
  unique (ticket_id, role)
);
select kernel.enable_tenant_rls('financials.tm_ticket_signoffs');
select kernel.enable_retention_guard('financials.tm_ticket_signoffs');

-- What a converted ticket became: one direct cost per kind (labour, plant, materials), each posted to the budget line.
create table financials.tm_ticket_direct_costs (
  org_id          uuid not null,
  ticket_id       uuid not null references financials.tm_tickets (id),
  direct_cost_id  uuid not null references financials.direct_costs (id),
  primary key (ticket_id, direct_cost_id)
);
select kernel.enable_tenant_rls('financials.tm_ticket_direct_costs');

select kernel.grant_module_schema('financials');
