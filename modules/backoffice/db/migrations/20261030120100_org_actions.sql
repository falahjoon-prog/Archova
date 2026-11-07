-- Customer account actions taken by staff: trial extensions, plan changes, suspension and reactivation
-- (backend 09 §6). Rows are append-only; the customer-visible audit log and the weekly report read from here.

create table backoffice.org_actions (
  id             uuid primary key,
  -- Named `target_org_id`, not `org_id`, so the RLS lint does not treat this global table as tenant data.
  target_org_id  uuid not null references backoffice.tenant_directory (id),
  kind           text not null check (kind in ('trial.extend', 'plan.change', 'suspend', 'reactivate')),
  summary        text not null,
  reason         text not null,
  ticket_ref     text not null,
  staff_id       uuid not null references backoffice.staff_users (id),
  created_at     timestamptz not null default now()
);
create index org_actions_org on backoffice.org_actions (target_org_id, created_at desc);

select kernel.grant_module_schema('backoffice');
