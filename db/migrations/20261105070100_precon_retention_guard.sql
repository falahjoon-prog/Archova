-- Composed from modules/precon/db/migrations/20261105070100_precon_retention_guard.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Decided prequalification forms and the question sets they were answered against are kept 7 years (see the
-- prequalification_7y retention category) and never deleted under a legal hold. Forms are archived or superseded by a
-- newer form, not erased; this stops erasure jobs and cascades.

select kernel.enable_retention_guard('precon.prequalifications');
select kernel.enable_retention_guard('precon.prequal_templates');
