# Design documentation

Owner: **Uma** (UI/UX). Status: **Draft v0.1, 2 Oct 2026.** No code yet; these docs come first, as john asked.

The product is named **Archova** (decision X24 in `docs/architecture/cross-team-decisions.md`). Tokens keep a neutral `--c-*` prefix so the brand can change without renaming code. The brand colour stays a placeholder until the logo work lands. Nothing here copies Procore's look, wording or layout.

| # | Doc | What it decides |
|---|---|---|
| 1 | [Design principles](01-principles.md) | The six rules every screen is judged against |
| 2 | [Design system](02-design-system.md) | Colour, type, spacing, elevation, motion, icons, and the full component inventory |
| 3 | [Navigation and information architecture](03-navigation-ia.md) | Company/project hierarchy, nav model, URLs, search, permissions in the UI |
| 4 | [Screen flows](04-screen-flows.md) | Key flows for web and mobile, phase by phase |
| 5 | [Accessibility](05-accessibility.md) | WCAG 2.2 AA commitments, testing and the definition of done |

## How these docs connect to the rest of the team

- **Architecture (Ava, `docs/architecture/`)**: the permission model, tenancy and offline sync rules there drive what the UI shows. Where this folder assumes something about the backend, it is marked **[Assumes architecture]** so Ava can confirm or correct it.
- **Engineering**: the design system maps one-to-one to the planned stack (Tailwind + shadcn/ui on web, Expo / React Native on mobile). Tokens are written once and exported to both.
- **Product plan (`plans/plan.md`)**: phases and module names come from there. If the plan changes, section 4 of the flows doc changes with it.

## Open design questions for john

1. Brand colour: waiting on the logo work. The placeholder palette already passes contrast, and the brand hue can be swapped without touching anything else.
2. Will clients/superintendents mostly use the web app or a lighter portal? This affects how much of the full nav they see (doc 3, section 6).
3. Do any pilot builders run sites in very bright outdoor conditions on older Android devices? That would push the mobile "site mode" (doc 2, section 2.5) from optional to default.
