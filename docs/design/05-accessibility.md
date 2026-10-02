# 5. Accessibility

**Target: WCAG 2.2 Level AA** across web and mobile, from phase 0. This is also a sales requirement: government and tier-1 clients in Australia ask for it in procurement, and the Disability Discrimination Act applies to us as a supplier.

Accessibility is part of the definition of done for every feature, not a later audit.

## 1. Rules every screen follows

| # | Rule | How we meet it |
|---|---|---|
| A1 | Text contrast ≥ 4.5 : 1 (≥ 3 : 1 for 18 px+ / 14 px bold) | Token palette is pre-checked (design system, section 2). No raw colours. |
| A2 | UI component and focus contrast ≥ 3 : 1 | Control borders use `--c-border-control` (4.8 : 1). Focus ring 2 px brand colour with 2 px offset. |
| A3 | Colour is never the only signal | Status = icon + label + colour. Drawing pins use shape + number, not colour alone. Charts have labels or a table. |
| A4 | Everything works by keyboard | Logical tab order, visible focus, no traps. Drawing viewer has keyboard pan/zoom and a list view of pins. |
| A5 | Screen-reader support | Semantic HTML first; Radix/shadcn primitives for ARIA patterns. Every icon-only control has a name. Live regions announce toasts, sync status, and form errors. |
| A6 | Text resizes to 200% without loss | `rem` units; layouts reflow at 320 px width. Mobile honours Dynamic Type / font scale. |
| A7 | Touch targets | Web ≥ 24 × 24 px (WCAG 2.2 minimum); our standard is 40 px on web and 48 px on mobile. |
| A8 | Forms are understandable | Visible labels, required marked in text, errors next to the field and summarised at the top, with how to fix. Never clear a form on error. |
| A9 | Time limits | No session timeout loses unsaved work; drafts auto-save. SOPA deadline warnings are informational, never timed popups. |
| A10 | Motion | Respects `prefers-reduced-motion`; nothing flashes more than 3 times per second. |
| A11 | Consistent help and navigation | Help is in the same place on every screen (WCAG 2.2, 3.2.6). Nav order is consistent. |
| A12 | Accessible authentication | No cognitive tests at login; passkeys and password managers supported; paste allowed in all fields (WCAG 2.2, 3.3.8). |
| A13 | Dragging has an alternative | Reordering, drawing pins and file upload all have a non-drag path (WCAG 2.2, 2.5.7). |
| A14 | Language | `lang="en-AU"`; plain language in UI copy; jargon only where it is the trade term. |

## 2. Hard areas and how we handle them

- **Drawings and photos**: a drawing cannot be fully described to a screen reader, so we expose everything *on* it as structured data: sheet title and number, revision, a list of pins/markups with their linked item, and searchable text from the title block. Photos take an optional caption; AI can suggest a caption, which the user confirms.
- **Large data tables**: real `<table>` markup with header associations, sortable column state announced, row selection announced, virtualisation that keeps the row count accessible.
- **Money and claims**: amounts read in full ("one hundred and twenty thousand dollars, excluding GST"), not as stripped digits. Totals are announced when they change.
- **AI content**: marked with a text label ("AI draft"), not just colour; the Accept / Edit / Discard controls are keyboard reachable; answers are announced via a polite live region.
- **Offline / sync states**: announced, and shown with text ("3 items waiting to sync"), not only an icon.

## 3. Site conditions (beyond WCAG)

Site users have situational impairments: glare, gloves, noise, one hand busy.
- Site mode (high contrast, larger text, 2 px borders).
- Primary actions in thumb reach; no small swipe-only gestures for important actions.
- Voice input for notes (OS dictation, later AI transcription) so typing isn't required.
- No sound-only alerts; haptics plus visual.

## 4. Testing

| When | What |
|---|---|
| Every PR touching UI | Automated axe checks on component stories and key pages (fails CI on serious/critical issues). **[Assumes architecture]** |
| Every component | Keyboard and screen-reader check documented in its story before it is marked ready. |
| Every release | Manual pass on the release's new flows with NVDA + Firefox, VoiceOver + Safari (macOS & iOS), TalkBack + Chrome (Android). |
| Each phase end | External audit against WCAG 2.2 AA; publish an accessibility statement and conformance report (VPAT / EN 301 549 format) for procurement. |
| Ongoing | At least one usability session per phase with a participant who uses assistive technology. |

## 5. Definition of done (accessibility)

A feature is not done until:
1. It uses only design-system tokens and components (or a reviewed new component).
2. Automated checks pass with no serious or critical issues.
3. It is fully usable with keyboard only and with one screen reader.
4. It works at 200% zoom and at 320 px width (web), and at the largest OS font size (mobile).
5. Error, empty, loading and offline states are designed and announced.
