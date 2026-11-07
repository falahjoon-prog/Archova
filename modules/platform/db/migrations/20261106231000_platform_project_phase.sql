-- platform: the phase a project is in (planning to defects liability), shown on the portfolio phase chart. Nullable:
-- existing projects have none until someone sets it. Separate from `status`, which says whether the project is live.
alter table platform.projects
  add column phase text check (phase in ('planning', 'design', 'tender', 'pre_construction', 'construction', 'handover', 'defects_liability'));
