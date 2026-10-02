# 1. Design principles

These are the tie-breakers. When two good options conflict, the higher principle wins.

## P1. Built for the site, not just the office
A site manager with gloves, glare and patchy signal is the hardest user we have. If a flow works for them, it works for the PM at a desk.
- Mobile touch targets are at least **48 × 48 px**; primary field actions sit in the bottom third of the screen.
- Every field capture (photo, defect, diary entry) works offline and says clearly when it has synced.
- High-contrast "site mode" is one tap away.

## P2. The record is evidence
RFIs, transmittals, claims and payment schedules end up in disputes and adjudication. The UI must make the record trustworthy.
- Never silently change a submitted record. Edits after submission create a new revision with who, when and why.
- Show the audit trail on every record, not buried in an admin screen.
- Dates and deadlines show the exact date, time zone and the rule that produced them (for example "Schedule due 16 Oct 2026, 10 business days, NSW SOPA").
- Destructive actions on evidence records are void-with-reason, not delete.

## P3. One clear next action
Construction teams are busy and interrupted. Each screen answers "what do I need to do here?"
- One primary button per view. Secondary actions go in a menu.
- Lists open on "Assigned to me / Overdue" when the user has items; otherwise on everything.
- Empty states tell the user the single thing to do next.

## P4. Dense where it helps, calm everywhere
PMs scan registers of hundreds of drawings and RFIs; subcontractors visit once a week. We serve both.
- Registers default to a compact table with user-adjustable density (compact / comfortable).
- Detail pages are roomy, with a clear reading order.
- Colour carries status only. Decoration is neutral.

## P5. Same patterns everywhere
RFIs, submittals, defects, inspections and variations are all "a numbered item with a status, an owner, a due date and a conversation". They share one layout (the **Item pattern**, doc 2 section 4.4), so learning one tool means learning them all, and new modules in later phases cost less to design and build.

## P6. AI that assists, never decides
AI drafts, summarises, finds and suggests. A person always reviews and commits.
- AI output is labelled, shows its sources, and is editable before it is saved.
- AI never submits a claim, approves a variation, closes a defect or sends a transmittal on its own.
- Every AI feature has a non-AI path to the same result.
- Users can switch AI suggestions off per company (admin setting) and per person.

## How we check a design against these
Every design review (and every PR that changes UI) answers six questions:
1. Can a site user do this one-handed, outdoors, offline? (P1)
2. If this ends up in a dispute, is the history complete and visible? (P2)
3. What is the one primary action? (P3)
4. Is colour used only for meaning? (P4)
5. Does it reuse an existing pattern, or does it need a new one, and why? (P5)
6. If AI is involved, can the user see the source, edit it, and opt out? (P6)
