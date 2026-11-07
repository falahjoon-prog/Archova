-- financials: change events, the potential changes raised before they are priced (a design change, a latent
-- condition, a client request). A change event stays open while it is being priced. Raising a variation or a
-- commitment from it (they carry `change_event_id`) moves it to converted_to_variation / converted_to_commitment.
-- Closing needs a reason. Estimates are ex GST and optional. Financial records: 7 years.

create table financials.change_events (
  id          uuid primary key,
  org_id      uuid not null,
  project_id  uuid not null,
  number      int not null,
  title       text not null check (length(title) between 1 and 300),
  description text check (description is null or length(description) <= 5000),
  reason      text not null check (reason in ('design_change', 'latent_condition', 'client_request', 'rfi', 'other')),
  estimate    numeric(18,2) check (estimate is null or estimate >= 0),
  status      text not null default 'open' check (status in ('open', 'converted_to_variation', 'converted_to_commitment', 'closed')),
  closed_note text,
  closed_at   timestamptz,
  closed_by   uuid,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  version     int not null default 1,
  unique (project_id, number),
  check ((status = 'closed') = (closed_at is not null)),
  check (status <> 'closed' or closed_note is not null)
);
create index change_events_project on financials.change_events (org_id, project_id, number);
select kernel.enable_tenant_rls('financials.change_events');
select kernel.enable_retention_guard('financials.change_events');

alter table financials.variations
  add column change_event_id uuid references financials.change_events (id);
create index variations_change_event on financials.variations (org_id, change_event_id)
  where change_event_id is not null;

alter table financials.commitments
  add column change_event_id uuid references financials.change_events (id);
create index commitments_change_event on financials.commitments (org_id, change_event_id)
  where change_event_id is not null;

select kernel.grant_module_schema('financials');
