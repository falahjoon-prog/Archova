-- Composed from modules/financials/db/migrations/20261122100000_financials_adjudication_clock_starts.sql by tools/db/compose.ts. Edit the source, then run pnpm db:compose.
-- financials: the two events that start the respondent's response clock (compliance/01b): the day the respondent
-- received the application, and the day it received notice of the adjudicator's acceptance. Kept so a computed
-- suggested due date can show how it was reached; the date typed from the adjudicator's notice stays the authority.

alter table financials.claim_adjudications
  add column application_received_on date,
  add column acceptance_notice_received_on date;
