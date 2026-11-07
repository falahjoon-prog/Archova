-- Composed from packages/kernel/db/migrations/20261107000100_outbox_org_time_index.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- archova:no-transaction
-- The audit log pages shared.outbox newest first per org; without this every page sorts the org's events.
create index concurrently if not exists outbox_org_time on shared.outbox (org_id, occurred_at desc, id desc);
