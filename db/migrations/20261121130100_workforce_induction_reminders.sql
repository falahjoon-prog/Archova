-- Composed from modules/workforce/db/migrations/20261121130100_workforce_induction_reminders.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- Induction depth: re-induction after a lapse. Expiry reminders need no table: the daily job's notifications are keyed
-- by completion, step and expiry date.
--
-- A completion that has expired on the version still in force is redone as a new cycle of the same version (the
-- signed one stays sealed, it is a WHS record), so the unique key gains the cycle.
alter table workforce.induction_completions add column cycle int not null default 1 check (cycle >= 1);
alter table workforce.induction_completions drop constraint induction_completions_version_id_worker_id_key;
alter table workforce.induction_completions add constraint induction_completions_version_worker_cycle_key
  unique (version_id, worker_id, cycle);

select kernel.grant_module_schema('workforce');
