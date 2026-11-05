-- Composed from modules/safety/db/migrations/20261105072915_safety_incident_retention_guard.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Incident records are kept at least 5 years from notification (WHS Act s38(7), compliance 07) and never deleted
-- under a legal hold. Events already refuse every delete. People rows are corrected in place by the use case, so
-- they are not guarded one by one; the incident row they hang off is.

select kernel.enable_retention_guard('safety.incidents');
select kernel.enable_retention_guard('safety.incident_actions');
