-- scheduling: one saved baseline per programme revision (product/08 S4). The dates the programme was planned to run at
-- when the baseline was set; the live dates are compared against them to show slippage. Setting again replaces it.

alter table scheduling.schedules add column baseline_set_at timestamptz;
alter table scheduling.activities add column baseline_start date;
alter table scheduling.activities add column baseline_finish date;
alter table scheduling.activities add constraint activities_baseline_dates
  check ((baseline_start is null) = (baseline_finish is null) and (baseline_finish is null or baseline_finish >= baseline_start));
