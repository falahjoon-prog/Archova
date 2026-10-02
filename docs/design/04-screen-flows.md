# 4. Key screen flows (web and mobile)

Each flow lists: who, the trigger, the steps, the screens involved, and the states that must be designed. Phase numbers follow `plans/plan.md`. Wireframes will be added per flow as the next design step; these flows are the spec they are drawn against.

Notation: **[W]** web, **[M]** mobile, **[W/M]** both. ★ marks the one primary action on a screen.

---

## 1. Phase 0: getting in and set up

### F0.1 Sign up and create a company account [W]
**Who:** builder admin. **Trigger:** trial sign-up or sales-led invite.
1. Sign up (email + password, Google/Microsoft, or passkey). Email verification.
2. Company details: name, ABN (validated), state, size.
3. Choose plan / start trial: licence card shows what's included. ★ Start trial.
4. Create first project (F0.2) or import a project list (CSV).
5. Invite team (F0.3).
**States:** ABN invalid, email already in use (offer to join existing account), SSO-enforced domain.

### F0.2 Create a project [W]
**Who:** admin or PM.
1. Project basics: name, number, address (autocomplete), **state** (drives SOPA rules), contract value, dates.
2. Choose a project template (tools enabled, folders, permission templates, numbering).
3. ★ Create project → lands on Project home with a setup checklist (upload drawings, invite team, add companies).

### F0.3 Invite people and companies [W]
1. Directory → ★ Invite. Enter emails (or paste a list / upload CSV).
2. For each: company (existing or new, with ABN lookup), role / permission template.
3. Review → Send. Invitee gets an email with the project name and who invited them.
4. Invitee accepts: if they already have an account anywhere on the platform, the project appears in their cross-account inbox; otherwise a 2-field sign-up.
**States:** seat/licence limit reached (show plan card and upgrade path to admins only; others see "Ask your admin"), duplicate person, bounced email.

### F0.4 Licence and billing admin [W]
Admin → Licence & billing: current plan, usage meters (projects, storage, AI credits), renewal date, invoices, payment method, change plan. Downgrades that would exceed limits explain exactly what to archive first.

---

## 2. Phase 1: core project management

### F1.1 Project home [W/M]
Sections in order: **My items** (assigned to me, grouped Overdue / Due this week / Later), **Key dates** (RFI due, submittals, upcoming SOPA dates from P3), **Recent activity**, **Weather** (site location), **Quick add**. AI **"Since you were last here"** summary at top, dismissible.

### F1.2 Upload drawings and publish a set [W]
**Who:** document controller / PM.
1. Drawings → ★ Upload drawings. Drop a multi-sheet PDF or many files.
2. Processing: the system splits sheets and reads title blocks (sheet number, title, revision, discipline). **AI** fills these fields; low-confidence fields are highlighted for review.
3. Review table: one row per sheet, editable, with thumbnail. Conflicts flagged (same number, older revision, duplicate).
4. ★ Publish. New revisions become current; previous become **superseded** (still viewable, clearly marked).
5. Optional: create a transmittal for the published set (F1.6).
**States:** upload interrupted (resumable), unreadable title block, revision going backwards (requires confirmation with reason).

### F1.3 View and mark up a drawing [W/M]
1. Drawings register (table on web, grid/list on mobile, filter by discipline/area).
2. Open sheet: viewer with revision badge, "Superseded, view current" banner when relevant.
3. Toolbar: markup tools, pins of linked items (RFIs, defects), sheet hyperlinks.
4. Markups can be private, shared with my company, or published to the project.
5. Compare revisions (side-by-side or overlay with change highlight).
**Mobile:** sets downloaded for offline; pinch-zoom; long-press to drop a defect/RFI pin.

### F1.4 Raise and answer an RFI [W/M]
**Who:** raised by builder PM/site manager (or subbie, routed via builder); answered by consultant/superintendent.
1. RFIs → ★ New RFI. Subject, question (rich text), linked drawing + pin, spec section, attachments, assignee (person/company), due date (default from project setting, shows business days), distribution list, cost/time impact (yes/no/TBC).
2. **AI:** "Check for similar RFIs" before submitting (avoid duplicates); "Improve question" suggests a clearer wording.
3. ★ Submit → status Open, notifications sent, appears on drawing.
4. Assignee view: question, references, ★ Respond. **AI:** "Draft response" from specs/drawings, with citations; must be edited or accepted.
5. Builder marks a response **official** and ★ Closes; or reopens with a comment.
6. If impact = yes, ★ "Create variation / change event" carries the link (P3).
**States:** overdue (danger chip), reassigned, ball-in-court shown clearly ("Waiting on: Smith Engineers"), draft auto-saved.

### F1.5 Submittals [W]
Same Item pattern as RFIs, with a workflow: submitter → builder review → consultant review(s) → returned with status (Approved / Approved as noted / Revise & resubmit / Rejected). Revisions of a submittal keep history. Approval stepper shows who has it now.

### F1.6 Send a transmittal [W]
1. From Documents/Drawings selection, or Transmittals → ★ New.
2. Pick revisions (search, or "current set for discipline X"), recipients, purpose (for construction / for information / for tender), message.
3. Preview PDF cover sheet. ★ Send.
4. Transmittal page shows per-recipient **sent / opened / downloaded** receipts. Immutable once sent.

### F1.7 Site diary (daily log) [W/M]
**Who:** site manager, end of each day (often on phone).
1. Diary → today's entry opens automatically (pre-filled weather from location, yesterday's labour as a starting point).
2. Sections, each collapsible and optional: Weather, Labour (company + headcount + hours), Plant, Deliveries, Visitors, Delays (type, hours, cause), Notes, Photos.
3. **AI:** "Write today's summary" from photos, notes and voice memo; "Flag possible delay" if weather or notes suggest one (useful for extension-of-time claims).
4. ★ Submit day. Becomes locked; edits after submission create a revision with reason (P2).
**Mobile:** fully offline, voice-to-text notes, photo burst.
**States:** missed day (reminder next morning), late entry (marked with actual entry time).

### F1.8 Defects: capture, assign, close [W/M]
**Who:** site manager / client walk-through creates; subcontractor fixes; builder verifies.
1. **[M] Capture:** ＋ Capture → Defect → take photo(s) → drop pin on drawing (or pick location from list) → trade/company (AI suggests from photo + description) → due date → ★ Save. Under 30 seconds for a simple defect is the target.
2. Bulk walk mode: capture many in a row without leaving the camera; review list at the end.
3. Subcontractor receives it in their inbox → ★ Mark ready for inspection with "after" photo.
4. Builder ★ Close (with evidence) or reject with reason.
**States:** offline (queued, count shown), photo too dark (prompt to retake), assigned company not on project yet (invite inline).

### F1.9 Meetings and minutes [W]
Agenda from template → during meeting, items captured as discussion / decision / action (actions become assigned items) → **AI:** draft minutes from notes or recorded transcript (with attendee consent) → review → ★ Distribute. Open actions carry to next meeting.

### F1.10 Photos [W/M]
Auto-organised by date, location and linked item. Bulk upload; tag; **AI:** search photos by content ("formwork level 4"), suggested captions.

---

## 3. Phase 2: quality and safety (summary)
- **Inspections:** company checklist templates → schedule on project → run on mobile (pass/fail/NA per item, photos, signature) → failed items auto-create defects/observations.
- **Observations and incidents:** quick capture on mobile, severity, notification rules; incidents follow notifiable-incident guidance with a locked record.
- **WHS:** SWMS register and review, site inductions (worker completes on their own phone via QR code, no account needed), permits to work with expiry.

## 4. Phase 3: financials and SOPA claims

### F3.1 Submit a progress claim (subcontractor → builder) [W]
1. Contract page → ★ New claim for period ending (defaults to contract's claim date).
2. Claim table: schedule of values lines + approved variations, enter % complete or amount this period; previous claimed shown; totals, retention, GST calculated live.
3. Required statutory wording for the project's state inserted automatically (not editable by the claimant; legal text maintained centrally).
4. Attach supporting docs (statutory declaration / supporting statement per state).
5. Review summary: **SOPA deadline chip** shows when the builder's payment schedule is due and the rule used. ★ Submit claim.
6. Locked record, PDF generated, audit entry.

### F3.2 Assess a claim and issue a payment schedule (builder) [W]
1. Inbox / Claims register, sorted by schedule due date; deadline chips go warning at 3 business days, danger at 1.
2. Open claim: side-by-side claimed vs assessed per line; enter assessed amounts; **reasons required for any line reduced** (SOPA requirement), with reason templates.
3. **AI:** "Check claim" flags lines over 100%, variations not approved, arithmetic or retention errors, and claims for work not in the diary/photos. Flags only; the assessor decides.
4. Approval stepper if company requires sign-off.
5. ★ Issue payment schedule → PDF with statutory wording, sent and logged with timestamp.
**States:** deadline passed (danger banner, explain consequence in plain words and suggest seeking advice), claim withdrawn, disputed.

### F3.3 Variations [W/M]
Raise (often on mobile from site, with photos) → price → submit → approve/reject with reason → flows into next claim. Links to originating RFI/instruction.

### F3.4 Mobile app (offline) [M]
First-run: sign in, pick projects, choose what to keep offline (drawings for my areas, my open items). Sync indicator in header: Synced ✓ / Pending (n) / Failed (tap for details). Conflicts are shown as "Someone else changed this", with both versions, never silently overwritten. **[Assumes architecture]**: sync and conflict model from Ava's docs.

---

## 5. Phases 4–5 (to be detailed when those phases are planned)
Scheduling (Gantt + lookaheads, mobile read-only "my next 2 weeks"), tendering (invite subbies, bid levelling comparison table), BIM viewer with issues linked to RFIs, timesheets on mobile, owner portal (simplified, read-mostly), portfolio report builder.

---

## 6. Cross-cutting flows

| Flow | Notes |
|---|---|
| **Item pattern** | All numbered items share: Item header (number, title, status, ball-in-court, due date, ★ primary action) → Details tab → Activity/audit tab → Related tab → comment thread. |
| Comment and mention | @person notifies; #RFI-042 links. Comments are part of the audit trail and cannot be edited after 5 min (edit history shown). |
| Export | Any register or item → PDF/CSV, respecting current filters; branded with the builder's logo. |
| Bulk actions | Select rows → assign, change status, set due date, export, add to transmittal. |
| Void instead of delete | Records with external visibility can only be voided with a reason; they remain visible as void. |
| Cross-account inbox (subbies) | One list of everything assigned to me across all builders, grouped by project. |

---

## 7. AI touchpoints summary

| Where | AI feature | Guardrail |
|---|---|---|
| Drawings upload | Read title blocks to fill sheet number, title, revision | Low-confidence fields highlighted; human publishes |
| RFIs | Duplicate check, improve question, draft response with citations | Draft only; official response is human-marked |
| Site diary | Summary from notes/photos/voice, possible-delay flag | User submits the day |
| Defects | Suggest trade/company from photo and text | User confirms assignee |
| Meetings | Draft minutes and actions from notes/transcript | Recording needs attendee consent; human distributes |
| Photos | Content search, captions | Captions editable |
| Claims | Check claim for errors and unsupported lines | Flags only; assessor decides amounts and reasons |
| Everywhere | Ask panel (Q&A over project records), "since you were last here" summary | Only records the user can access; every answer cites sources |

All AI outputs follow principle P6 and the AI components in doc 2, section 7.7. **[Assumes architecture]**: permission-aware retrieval, per-tenant data isolation, and no customer data used to train shared models without opt-in.
