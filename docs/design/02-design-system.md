# 2. Design system

One source of truth for web (Tailwind + shadcn/ui) and mobile (Expo / React Native). Tokens are defined once in a platform-neutral JSON file and exported to CSS variables, a Tailwind preset and a React Native theme object. **[Assumes architecture]**: a shared `@archova/design-tokens` package in the monorepo.

Contrast ratios below were calculated against the stated background using the WCAG 2.x formula.

## 1. Token layers

| Layer | Example | Who uses it |
|---|---|---|
| Primitive | `blue-600 = #1F4FC4` | Only the token file. Never referenced in components. |
| Semantic | `--c-action-primary`, `--c-text-muted`, `--c-status-overdue` | Components and screens |
| Component | `--button-primary-bg` | Only where a component needs to diverge |

Rule: components use semantic tokens only. A raw hex value in component code fails review.

## 2. Colour

The brand hue is a placeholder ("deep steel blue") until the name and brand are chosen. Swapping it means changing primitives only.

### 2.1 Light theme

| Semantic token | Value | Contrast on #FFFFFF | Use |
|---|---|---|---|
| `--c-bg` | #F9FAFB | n/a | App background |
| `--c-surface` | #FFFFFF | n/a | Cards, tables, panels |
| `--c-text` | #111827 | 17.7 : 1 | Body text |
| `--c-text-secondary` | #4B5563 | 7.6 : 1 | Labels, meta |
| `--c-text-muted` | #6B7280 | 4.8 : 1 | Placeholders, hints (minimum for text) |
| `--c-border-control` | #6B7280 | 4.8 : 1 | Input, checkbox, select outlines (must be ≥ 3 : 1) |
| `--c-border-divider` | #E5E7EB | decorative | Table rules, card edges only |
| `--c-action-primary` | #1F4FC4 | 7.1 : 1 | Primary buttons, links, focus |
| `--c-action-primary-hover` | #183E9C | 9.5 : 1 | Hover / pressed |
| `--c-focus-ring` | #1F4FC4, 2 px + 2 px offset | 7.1 : 1 | Keyboard focus |

### 2.2 Status colours
Status always pairs colour with an icon and a text label (accessibility doc, rule A3).

| Status family | Token | Value (light) | Value (dark) | Icon | Used for |
|---|---|---|---|---|---|
| Success | `--c-status-success` | #157A3D (5.4 : 1) | #4ADE80 | check-circle | Closed, approved, paid, synced |
| Warning | `--c-status-warning` | #A65A00 (5.1 : 1) | #FBBF24 | alert-triangle | Due soon, pending review, partial |
| Danger | `--c-status-danger` | #B42318 (6.6 : 1) | #F87171 | alert-octagon | Overdue, rejected, sync failed, SOPA deadline at risk |
| Info | `--c-status-info` | #0B6A9E (5.9 : 1) | #5CC4F5 | info | Open, in progress, draft |
| Neutral | `--c-status-neutral` | #4B5563 | #AEB6C2 | circle | Void, superseded, archived |

Each family also has a `-subtle` background (about 8% tint) for badges and banners.

### 2.3 AI colour
`--c-ai` #6D3FD1 (6.4 : 1 light) / #B79CFF (dark). Used only for the AI sparkle icon, AI-suggestion borders and the "AI draft" label, so users always know when content came from AI.

### 2.4 Site accent
`--c-accent-hivis` #E8590C (safety orange). Only for map/drawing pins and the "site mode" toggle. Text on it is always `--c-text` (#111827, 4.95 : 1); white text on it fails and is not allowed.

### 2.5 Dark theme and site mode
- **Dark theme**: bg #0F141C, surface #171E29, text #F3F4F6 (16.8 : 1), secondary #AEB6C2 (9.0 : 1), primary action #7FA3FF with dark text. Follows the OS setting, overridable per user.
- **Site mode (mobile)**: high-contrast variant for direct sunlight. Pure black on white, borders 2 px, body text one step larger, status colours darkened. Toggle in the mobile header; remembered per device.

### 2.6 Data visualisation
Dashboards use an 8-step categorical palette checked for colour-blind separation (to be finalised with the brand). Charts always have direct labels or a table alternative.

## 3. Typography

**Typeface:** Inter (web, open licence, excellent tabular numerals) with system fallback. Mobile uses the platform font (SF Pro / Roboto) for performance and native feel. **Numbers in tables and money use tabular figures** (`font-variant-numeric: tabular-nums`) so columns of dollars line up.

| Token | Size / line height (web) | Weight | Use |
|---|---|---|---|
| `display` | 30 / 36 | 600 | Dashboard hero numbers only |
| `h1` | 24 / 32 | 600 | Page title |
| `h2` | 20 / 28 | 600 | Section title |
| `h3` | 16 / 24 | 600 | Card / panel title |
| `body` | 14 / 20 | 400 | Default web text (desk users, dense data) |
| `body-lg` | 16 / 24 | 400 | Long-form reading (RFI question, minutes) |
| `label` | 13 / 16 | 500 | Field labels, table headers |
| `caption` | 12 / 16 | 400 | Meta, timestamps (never below 12) |
| `mono` | 13 / 20 | 400 | Document numbers, cost codes, IDs |

Mobile body is 16 / 24 minimum. All sizes are in `rem` / scalable points so OS text-size settings work up to 200%.

## 4. Spacing, layout and shape

- **Spacing scale (4 px base):** 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Tokens `space-0` to `space-11`.
- **Radius:** `sm` 4 px (inputs, badges), `md` 8 px (cards, buttons), `lg` 12 px (sheets, modals), `full` (avatars, pills).
- **Elevation:** 0 flat, 1 card (subtle shadow), 2 dropdown / popover, 3 modal / sheet. Dark theme uses lighter surfaces instead of shadows.
- **Breakpoints:** `sm` 640, `md` 768 (tablet portrait), `lg` 1024 (tablet landscape / laptop), `xl` 1280, `2xl` 1536.
- **Grid:** 12 columns, 24 px gutters on desktop, 16 px on mobile. Max content width 1440 px; registers may go full width.
- **Density:** tables support `compact` (row 36 px) and `comfortable` (row 48 px). Mobile lists are always ≥ 56 px rows.

## 5. Motion
- Durations: 100 ms (hover, press), 200 ms (popover, toast), 300 ms (sheet, page transition).
- Easing: standard ease-out for enter, ease-in for exit.
- Motion is functional only. `prefers-reduced-motion` turns transitions into instant changes or fades.

## 6. Iconography
- One open-source outline icon set (Lucide, which ships with shadcn/ui), 20 px on web, 24 px on mobile, 1.5 px stroke.
- Each module has a fixed icon used in nav, search results, notifications and links, so a user learns "the RFI icon" once.
- Icons that act alone (no visible label) always have an accessible name and a tooltip on web.

## 7. Component inventory

Status: **P** = needed for phase 0/1 (MVP), **L** = later phase. Every component ships with: all states (default, hover, focus, active, disabled, loading, error), light/dark, keyboard behaviour, screen-reader name and role, and a usage note. Web builds on shadcn/ui (Radix primitives) where one exists; mobile equivalents are built to the same API.

### 7.1 Foundations
| Component | Phase | Notes |
|---|---|---|
| Button (primary, secondary, tertiary, danger, icon) | P | One primary per view. Loading state keeps width. |
| Link | P | Underlined in body text. |
| Icon, Avatar, Avatar group | P | Avatar falls back to initials + company colour. |
| Badge / Status pill | P | Always icon + label. Maps to status families. |
| Tooltip | P | Never holds essential info. |
| Divider, Skeleton, Spinner | P | Skeletons for lists, spinner only for < 1 s actions. |

### 7.2 Inputs
| Component | Phase | Notes |
|---|---|---|
| Text field, Textarea | P | Label always visible (no placeholder-as-label). |
| Rich text editor | P | For RFI questions, responses, minutes. Mentions (@person, #item). |
| Select, Combobox (searchable), Multi-select | P | Combobox for people, companies, cost codes. |
| Person / company picker | P | Shows company and role; groups by company. |
| Date picker, Date range | P | Shows business-day count when relevant (SOPA, RFI due). |
| Money input | P | AUD default, GST-aware, tabular figures, no float rounding (cents as integers). **[Assumes architecture]** |
| Percent input | P | For claim % complete. |
| Checkbox, Radio group, Switch | P | |
| File uploader (drag-drop, multi, resumable) | P | Shows per-file progress, retry, virus-scan state. |
| Camera capture (mobile) | P | Burst photos, annotate before save, works offline. |
| Signature pad | L | Inspections, permits to work. |
| Location / pin picker | P | Pin on drawing for defects. |

### 7.3 Navigation
| Component | Phase | Notes |
|---|---|---|
| App shell (top bar + sidebar) | P | Doc 3. |
| Project switcher | P | Recent + search; keyboard shortcut. |
| Sidebar module nav | P | Collapsible; badges show "assigned to me" counts. |
| Breadcrumbs | P | Company › Project › Module › Item. |
| Tabs | P | For item sub-views (Details, Activity, Related). |
| Command palette (⌘K / Ctrl K) | P | Jump to project, item, action; includes AI "Ask" entry. |
| Mobile bottom tab bar | L (P3) | Doc 3, section 5. |
| Pagination / infinite list | P | Tables paginate; mobile lists infinite with "back to top". |

### 7.4 Data display
| Component | Phase | Notes |
|---|---|---|
| **Data table / register** | P | The workhorse. Sort, filter, column chooser, saved views, bulk select, sticky header, CSV/PDF export, virtualised for 10k+ rows. |
| Filter bar + saved views | P | Views are shareable per project. |
| Card, Stat tile | P | |
| Description list (key/value) | P | Item detail fields. |
| Activity timeline / audit trail | P | Every change: who, what, before → after, when. Immutable look (no edit controls). |
| Comment thread | P | Mentions, attachments, "official response" marker for RFIs. |
| Attachment list / gallery | P | Thumbnails, lightbox, download, revision label. |
| Empty state | P | Illustration-free: icon, one sentence, one action. |
| Charts (bar, line, donut, progress) | L (P2) | Follows the data-vis palette. |
| Gantt / timeline | L (P4) | Scheduling. |

### 7.5 Feedback and overlays
| Component | Phase | Notes |
|---|---|---|
| Toast | P | Success and undo; never for errors that need action. |
| Inline alert / banner | P | Errors, offline, SOPA deadline warnings. |
| Modal dialog | P | Confirmations and short forms only. |
| Side sheet / drawer | P | Quick view of an item from a list without losing place. |
| Popover, Dropdown menu | P | |
| Confirmation with reason | P | Void, reject, supersede: requires a typed reason (P2). |
| Sync status indicator | L (P3) | Mobile: synced / pending (n) / failed. |
| Progress (linear, steps) | P | Multi-step forms (claims, onboarding). |

### 7.6 Domain components
| Component | Phase | Notes |
|---|---|---|
| **Item header** | P | Number, title, status pill, assignee, due date, primary action. Shared by RFI, submittal, defect, variation, inspection. |
| Drawing viewer | P | Pan/zoom, revision switcher, markups, pins, hyperlinks between sheets. pdf.js on web. |
| Markup toolbar | P | Pen, shapes, text, cloud, measure (L), colour by author. |
| Revision badge + compare | P | "Rev C (current)" vs superseded; side-by-side / overlay compare. |
| Transmittal composer | P | Pick revisions, recipients, purpose; read receipts. |
| Diary day view | P | Weather, labour by company, plant, delays, notes, photos. |
| Money summary (claim) | L (P3) | Claimed, approved to date, retention, GST, this claim, due dates. |
| SOPA deadline chip | L (P3) | Shows date, business days remaining, state rule; turns warning at 3 days, danger at 1. |
| Checklist builder / runner | L (P2) | Inspections. |
| Approval stepper | L (P3) | Multi-level approvals on variations/claims. |

### 7.7 AI components
| Component | Phase | Notes |
|---|---|---|
| AI sparkle button | P | Entry point; always labelled ("Draft response", "Summarise"). |
| AI suggestion block | P | Purple left border, "AI draft" label, source links, Accept / Edit / Discard. Never auto-saves. |
| Source citation chip | P | Links to the drawing, spec clause or RFI the AI used. |
| Ask panel | P | Side panel for questions about the project ("What RFIs are open on level 3?"). Answers cite records and respect the user's permissions. **[Assumes architecture]** |
| Feedback control | P | Thumbs up/down + optional note on every AI output. |

Planned AI touchpoints by module are listed in doc 4, section 7.

### 7.8 Account, licensing and admin
| Component | Phase | Notes |
|---|---|---|
| Plan / licence card | P | Current plan, seats or project count used, renewal date. |
| Usage meter | P | Storage, active projects, AI credits if metered. |
| Permission matrix editor | P | Roles × tools × levels (None / Read / Standard / Admin). |
| Invite flow | P | Bulk invite by email/CSV, choose company and role. |
| Billing history table | P | Invoices with PDF. |

## 8. Writing style (UI copy)
- Australian English (colour, organisation, licence as noun). Construction terms the AU market uses: defects (not punch list) by default, variations, site diary, superintendent, subbie in casual copy only.
- Terminology is configurable per company for a small set of words (for example "Defects" vs "Punch list") to support later markets.
- Buttons are verbs ("Send transmittal", not "OK"). Errors say what happened and what to do.
- Dates: `2 Oct 2026`; times 24h on site screens is a user setting. Money: `$1,234,567.00`, GST stated as "ex GST" or "inc GST" every time.

## 9. Governance
- Tokens and components live in a shared package; a Storybook (web) and an Expo gallery (mobile) document them.
- New components need a short proposal: problem, why existing components don't fit, states, accessibility notes.
- Visual regression tests on every component story. **[Assumes architecture]**: CI runs these.
