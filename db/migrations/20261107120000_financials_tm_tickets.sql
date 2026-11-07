-- Composed from modules/financials/db/migrations/20261107120000_financials_tm_tickets.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: time-and-materials (daywork) tickets. A ticket records labour, equipment and material used on site
-- for work not in the contract, is signed on site by the contractor and the principal's representative, and is then
-- converted once into direct costs (cost to us) or a draft variation (a charge, claimable once approved).
-- Lines and details are frozen from the first signature (enforced by the triggers below, not only by the use cases);
-- each signature stores a hash of what was signed. Every signature is *recorded by* a signed-in builder staff member
-- from the on-site signature of the named signer, with the request's IP and user agent. The principal's
-- representative's signature needs evidence: a ready file (photo of the signed docket) or, once the e-signature flow
-- lands, `esign_request_id`. Amounts are ex GST. Financial records: 7 years.

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
  quantity     numeric(10,2) not null check (quantity > 0 and quantity <= 1000000),
  unit         text not null check (length(unit) between 1 and 20),
  rate         numeric(18,2) not null check (rate >= 0 and rate <= 1000000),
  amount       numeric(18,2) not null check (amount >= 0),
  source_type  text check (source_type in ('timesheet_line', 'equipment_log')),
  source_id    uuid,
  check ((source_type is null) = (source_id is null))
);
create index tm_ticket_lines_ticket on financials.tm_ticket_lines (org_id, ticket_id, sort);
create index tm_ticket_lines_source on financials.tm_ticket_lines (org_id, project_id, source_type, source_id);
select kernel.enable_tenant_rls('financials.tm_ticket_lines');
select kernel.enable_retention_guard('financials.tm_ticket_lines');

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
  evidence_file_id  uuid,
  ip                text,
  user_agent        text,
  signed_at         timestamptz not null default now(),
  unique (ticket_id, role),
  check (role <> 'principal_rep' or evidence_file_id is not null or esign_request_id is not null)
);
select kernel.enable_tenant_rls('financials.tm_ticket_signoffs');
select kernel.enable_retention_guard('financials.tm_ticket_signoffs');

-- ---- Immutability, enforced in the database --------------------------------------------------------------------

-- Lines may change only while their ticket is a draft. A source (timesheet line or equipment log) can sit on one
-- non-void ticket only; the advisory lock makes two concurrent tickets queue on the same source.
create function financials.tm_lines_guard() returns trigger language plpgsql as $$
declare
  t_status text;
begin
  select status into t_status from financials.tm_tickets
    where id = coalesce(new.ticket_id, old.ticket_id);
  if t_status is distinct from 'draft' then
    raise exception 'T&M ticket lines can only change while the ticket is a draft' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and new.source_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('tm_source:' || new.source_id::text, 0));
    if exists (
      select 1 from financials.tm_ticket_lines l
        join financials.tm_tickets t on t.id = l.ticket_id
       where l.source_id = new.source_id and l.ticket_id <> new.ticket_id and t.status <> 'void'
    ) then
      raise exception 'that timesheet or equipment record is already on another T&M ticket' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger tm_lines_guard before insert or update or delete on financials.tm_ticket_lines
  for each row execute function financials.tm_lines_guard();

-- Tickets: converted and void are terminal; once signed (even partly) the content is frozen; status only moves
-- forward draft -> part_signed -> signed -> converted, or to void from anything not converted.
create function financials.tm_tickets_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'T&M tickets cannot be deleted' using errcode = 'P0001';
  end if;
  if old.status in ('converted', 'void') then
    raise exception 'a % T&M ticket cannot change', old.status using errcode = 'P0001';
  end if;
  if old.status <> 'draft' and (
       new.number is distinct from old.number or new.title is distinct from old.title
    or new.description is distinct from old.description or new.work_date is distinct from old.work_date
    or new.location is distinct from old.location or new.contractor is distinct from old.contractor
    or new.instructed_by is distinct from old.instructed_by or new.origin is distinct from old.origin
    or new.total is distinct from old.total or new.project_id is distinct from old.project_id
  ) then
    raise exception 'a signed T&M ticket''s content is frozen' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('part_signed', 'void'))
    or (old.status = 'part_signed' and new.status in ('signed', 'void'))
    or (old.status = 'signed' and new.status in ('converted', 'void'))
  ) then
    raise exception 'a T&M ticket cannot move from % to %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger tm_tickets_guard before update or delete on financials.tm_tickets
  for each row execute function financials.tm_tickets_guard();

-- Sign-offs are evidence: insert only while the ticket is open for signing, never change or delete.
create function financials.tm_signoffs_guard() returns trigger language plpgsql as $$
declare
  t_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'T&M sign-offs cannot be changed or deleted' using errcode = 'P0001';
  end if;
  select status into t_status from financials.tm_tickets where id = new.ticket_id;
  if t_status not in ('draft', 'part_signed') then
    raise exception 'a % T&M ticket cannot be signed', t_status using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger tm_signoffs_guard before insert or update or delete on financials.tm_ticket_signoffs
  for each row execute function financials.tm_signoffs_guard();

-- What a converted ticket became: one direct cost per kind (labour, plant, materials), each posted to the budget line.
create table financials.tm_ticket_direct_costs (
  org_id          uuid not null,
  ticket_id       uuid not null references financials.tm_tickets (id),
  direct_cost_id  uuid not null references financials.direct_costs (id),
  primary key (ticket_id, direct_cost_id)
);
select kernel.enable_tenant_rls('financials.tm_ticket_direct_costs');

select kernel.grant_module_schema('financials');
