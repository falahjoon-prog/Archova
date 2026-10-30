-- Composed from modules/ai/db/migrations/20261030170000_ai_credit_grants.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Extra Nova credits granted to an org by staff (top-ups, goodwill, promotions; ai/05 §4, §5). A grant adds to the
-- allowance of one calendar month (the org's local month, `period_start` is its first day) and does not roll over.
-- Rows are append-only: a mistaken grant is corrected with a later entry, never edited.
create table ai.ai_credit_grants (
  id            uuid primary key,
  org_id        uuid not null,
  period_start  date not null,
  credits       numeric(12, 2) not null check (credits > 0),
  kind          text not null check (kind in ('top_up', 'goodwill', 'promo')),
  reason        text not null,
  ticket_ref    text not null,
  granted_by    uuid not null,
  created_at    timestamptz not null default now()
);
create index ai_credit_grants_org_period on ai.ai_credit_grants (org_id, period_start);
select kernel.enable_tenant_rls('ai.ai_credit_grants');

grant select, insert on ai.ai_credit_grants to app_rw;
