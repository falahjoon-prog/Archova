-- archova:no-transaction
-- The audit log pages shared.outbox newest first per org; without this every page sorts the org's events.
create index concurrently if not exists outbox_org_time on shared.outbox (org_id, occurred_at desc, id desc);
