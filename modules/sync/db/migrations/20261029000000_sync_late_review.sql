-- sync (phase 1): deciding on held changes (X38). A held change gets its own id for the admin screens, and a
-- decided one keeps its row (who, when, why) but not what was asked for.

alter table sync.late_submissions
  add column id            uuid not null default gen_random_uuid() unique,
  add column decision_note text,
  add column accepted_version int;
