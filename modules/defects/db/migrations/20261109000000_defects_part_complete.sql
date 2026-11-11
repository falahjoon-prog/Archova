-- Each assignee marks their own part done; the final approver is told once the last one has. Cleared when the
-- item goes back for another round (reject, reopen, reassign) or an assignee leaves the item.
alter table defects.defects
  add column completed_user_ids uuid[] not null default '{}';
