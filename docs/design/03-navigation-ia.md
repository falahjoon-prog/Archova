# 3. Navigation and information architecture

## 1. The hierarchy

```
Account (the paying organisation / licence holder)
└── Company level
    ├── Portfolio (all projects, cross-project dashboards)
    ├── Directory (companies, people)
    ├── Company tools (templates, cost codes, checklists, permission templates)
    ├── Reports (cross-project)
    └── Admin (users, licence & billing, integrations, AI settings, security)
└── Project level (one project at a time)
    ├── Project home
    ├── Tools (grouped, see section 3)
    └── Project settings
```

People work **inside one project** most of the day. The company level is for PMs, executives and admins. Every screen belongs to exactly one of these two levels, and the UI always shows which.

## 2. App shell (web)

```
┌───────────────────────────────────────────────────────────────────────┐
│ [Logo] Company ▾ │ Project: Harbour St Tower ▾ │ [ ⌘K Search… ] │ ✦ Ask │ 🔔 │ ? │ (JD) │
├──────────────┬────────────────────────────────────────────────────────┤
│ Project home │ Breadcrumbs: Harbour St Tower › RFIs › RFI-042           │
│              │ ┌────────────────────────────────────────────────────┐ │
│ CORE         │ │ Page title                       [Primary action]  │ │
│  Documents   │ │ Filter bar / tabs                                  │ │
│  Drawings    │ │                                                    │ │
│  RFIs     3  │ │ Content                                            │ │
│  Submittals  │ │                                                    │ │
│  ...         │ └────────────────────────────────────────────────────┘ │
│ QUALITY      │                                                        │
│ FINANCIALS   │                                                        │
│ ...          │                                                        │
│ ⚙ Settings   │                                                        │
└──────────────┴────────────────────────────────────────────────────────┘
```

- **Top bar** (always visible): company switcher (only shown if the user belongs to more than one account, common for subcontractors), project switcher, global search / command palette, AI Ask, notifications, help, profile.
- **Left sidebar**: tools for the current level. Collapsible to icons at `lg`; becomes a drawer below `lg`.
- **Badges** on sidebar items show the count of items **assigned to me and open**, not totals.
- **Users can pin and reorder** their most-used tools; admins set the default order per project template.

## 3. Project tool groups

Groups mirror the plan's module map so later phases slot in without reshuffling. Tools appear only if the project has them enabled **and** the user has at least Read permission.

| Group | Tools | Phase |
|---|---|---|
| Home | Project home (my items, recent activity, key dates, weather) | 1 |
| Core | Documents, Drawings, Specifications, RFIs, Submittals, Transmittals, Correspondence, Meetings, Photos, Site diary, Defects | 1 |
| Quality & safety | Inspections, Observations, Incidents, Action plans, WHS (SWMS, inductions, permits) | 2 |
| Financials | Budget, Prime contract, Commitments, Change events, Variations, Direct costs, Progress claims, Forecasting | 3 |
| Schedule | Schedule, Lookaheads | 4 |
| Preconstruction | Tenders, Bid levelling, Estimates | 4 |
| Coordination | Models (BIM), Coordination issues | 5 |
| Resources | Timesheets, Crews, Equipment | 5 |
| Project admin | Project directory, Project settings, Permissions | 0 |

Company-level nav: Portfolio, Directory, Reports, Tenders (P4), Templates, Admin.

## 4. URL structure

Readable, stable, shareable URLs. Every item has a permanent link that survives renames.

```
/{accountSlug}/portfolio
/{accountSlug}/directory/companies/{companyId}
/{accountSlug}/admin/licence
/{accountSlug}/p/{projectNumber}/home
/{accountSlug}/p/{projectNumber}/rfis?view=my-open
/{accountSlug}/p/{projectNumber}/rfis/{rfiNumber}
/{accountSlug}/p/{projectNumber}/drawings/{sheetNumber}?rev=C
```

**[Assumes architecture]**: routing by human-readable project number and item number, resolved server-side to IDs and checked against permissions. Filters live in the query string so a filtered view can be pasted to a colleague.

## 5. Mobile navigation (phase 3 app; responsive web earlier)

Bottom tab bar, five items, chosen for site use:

| Tab | Content |
|---|---|
| Home | My items today, sync status, quick-add |
| Drawings | Offline drawing set for the current project |
| **＋ Capture** (centre, larger) | Photo, defect, diary note, observation, incident: one tap to start |
| Tools | Full list of project tools the user can access |
| Me | Notifications, profile, settings, site mode, offline storage |

- The project switcher sits in the header; the last project is remembered.
- Deep links from email/push notifications open the exact item (app if installed, web otherwise).
- Tablet layout (≥ 768 px) uses a left rail plus list/detail split view, closer to web.

## 6. Who sees what (role-based IA)

Permissions decide visibility; we never show a tool and then block it with an error. **[Assumes architecture]**: permission levels None / Read / Standard / Admin per tool, assigned via permission templates.

| Persona | Typical landing | Sees |
|---|---|---|
| Builder admin | Company portfolio | Everything, plus Admin and licence |
| Project manager | Project home | All project tools; financials |
| Site manager | Mobile Home / Project home | Core, quality & safety, diary; read-only financials if allowed |
| Subcontractor | "My items" across all projects they're invited to | Only items shared with or assigned to their company; their own contract and claims |
| Client / superintendent | Project home (simplified) | Shared documents, RFIs addressed to them, claims for assessment, reports |
| Consultant (architect, engineer) | My items | Drawings, RFIs, submittals routed to them |

Subcontractors are free users (plan, section 1) and often work for many builders. Their first experience is a **cross-account inbox** ("everything assigned to me, anywhere") so they don't need to understand each builder's setup.

## 7. Search and findability

- **Global search / command palette (⌘K / Ctrl K)**: projects, items by number or text, people, companies, and actions ("New RFI"). Results grouped by type with the module icon.
- **Search inside documents**: text in PDFs and drawings (title blocks, specs) is indexed. **[Assumes architecture]**: OCR and full-text index in a background worker.
- **AI Ask**: natural-language questions answered from records the user can see, with citations. Lives alongside search, never replaces it.
- **Numbering**: every item has a project-unique number with a module prefix (RFI-042, DEF-0193, VAR-017, PC-08). Numbers are what people say on site; they are prominent everywhere.

## 8. Notifications

- **In-app inbox** grouped by project, with filters (mentions, assigned, due soon, overdue, approvals).
- **Email**: one per event by default for external users (subcontractors, clients); daily digest by default for internal users. User-adjustable per tool.
- **Push (mobile)**: only for assignments, mentions, and deadlines within 24 h. Everything else waits.
- **SOPA deadlines** always notify, and cannot be fully muted by the responsible party (they can change channel, not turn it off).

## 9. Cross-linking

Records link to each other in both directions, shown in a **Related** tab on every item: an RFI links to the drawing revision it's about, the variation it caused, the meeting where it was discussed. Linking is how the platform becomes more useful than separate tools, so the "Link" action is on every Item header.
