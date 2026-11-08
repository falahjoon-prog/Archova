-- financials: change orders and payments on a commitment (subcontract or purchase order).
-- A commitment change order (CCO) raises or lowers an approved commitment by a signed amount against one budget line;
-- once approved it counts in the commitment's revised value and in that line's committed cost (kept in
-- budget_lines.committed under the line row lock). A payment is money paid to the vendor against an approved
-- commitment; it is never edited, a mistake is voided with a reason. Amounts are ex GST. Financial records: 7 years.

create table financials.commitment_change_orders (
  id             uuid primary key,
  org_id         uuid not null,
  project_id     uuid not null,
  commitment_id  uuid not null references financials.commitments (id),
  number         int not null,
  title          text not null check (length(title) between 1 and 300),
  budget_line_id uuid not null references financials.budget_lines (id),
  amount         numeric(18,2) not null check (amount <> 0),
  status         text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at   timestamptz,
  submitted_by   uuid,
  decided_at     timestamptz,
  decided_by     uuid,
  decision_note  text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  version        int not null default 1,
  unique (commitment_id, number),
  check (status <> 'rejected' or decision_note is not null)
);
create index commitment_change_orders_project on financials.commitment_change_orders (org_id, project_id, commitment_id);
select kernel.enable_tenant_rls('financials.commitment_change_orders');
select kernel.enable_retention_guard('financials.commitment_change_orders');

create table financials.commitment_payments (
  id            uuid primary key,
  org_id        uuid not null,
  project_id    uuid not null,
  commitment_id uuid not null references financials.commitments (id),
  number        int not null,
  amount        numeric(18,2) not null check (amount > 0),
  paid_on       date not null,
  reference     text check (reference is null or length(reference) between 1 and 100),
  status        text not null default 'recorded' check (status in ('recorded', 'void')),
  void_reason   text,
  voided_at     timestamptz,
  voided_by     uuid,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  version       int not null default 1,
  unique (commitment_id, number),
  check ((status = 'void') = (voided_at is not null)),
  check (status <> 'void' or void_reason is not null)
);
create index commitment_payments_project on financials.commitment_payments (org_id, project_id, commitment_id);
select kernel.enable_tenant_rls('financials.commitment_payments');
select kernel.enable_retention_guard('financials.commitment_payments');

select kernel.grant_module_schema('financials');
