-- Inductions over an access link (X45, X58): a worker with no account completes the induction on their phone
-- after verifying their mobile by SMS (or email). The completion keeps the link and the verified number.

alter table workforce.induction_completions
  drop constraint induction_completions_method_check,
  add constraint induction_completions_method_check check (method in ('self', 'assisted', 'link')),
  add column access_link_id uuid,
  add column verified_channel text check (verified_channel in ('sms', 'email')),
  add column verified_to text,
  add constraint induction_completions_link_check
    check (method <> 'link' or (access_link_id is not null and verified_to is not null));
