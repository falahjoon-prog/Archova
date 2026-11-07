-- Live agenda sections (product/07 MTG-US5, AC6): a section can be filled from a register (overdue RFIs, submittals due,
-- open defects by trade, delays this week). The list is read when the minutes are opened and frozen into the version
-- snapshot when they are issued, so only the source is stored here.
alter table meetings.sections
  add column live_source text
  check (live_source in ('rfis_overdue', 'submittals_due', 'defects_open', 'delays_week'));
