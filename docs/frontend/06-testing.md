# 06 · Frontend testing

Owner: Felix (with QA). Status: draft v1, 2 Oct 2026.

## 1. Test pyramid

| Layer | Tool | What it covers | Runs |
|---|---|---|---|
| Static | TypeScript strict, ESLint (incl. boundaries), Prettier | types, import rules, a11y lint | every commit |
| Unit | Vitest | `packages/domain` (incl. permissions), `query`, helpers, hooks with mocked client | every PR |
| Component | Vitest + Testing Library + MSW | each pattern and feature component across states | every PR |
| Visual | Storybook + Chromatic (or Playwright screenshots) | primitives and patterns, light/dark, breakpoints | every PR touching `ui` |
| Contract | generated types + zod checks against `@archova/contracts` fixtures | client and API agree | every PR |
| End-to-end | Playwright | critical user journeys in a real browser against a seeded environment | every PR (smoke), nightly (full) |
| Accessibility | axe in component tests and Playwright | WCAG violations | every PR |
| Performance | Lighthouse CI, size-limit | budgets in doc 05 | every PR |
| Load (with backend) | k6 driving API + browser sampling | 100k-user profile | before each release |

## 2. Critical journeys (Playwright, must never break)

1. Sign up, create org, create project, invite a subcontractor, subcontractor accepts.
2. Upload a drawing set, supersede a revision, see current vs superseded.
3. Raise an RFI linked to a drawing, assign, respond officially, close.
4. Create a site diary entry with labour, delays and photos.
5. Pin a defect on a drawing, assign to a subcontractor, close with evidence.
6. Submit a payment claim, issue a payment schedule, check SOPA due dates display correctly for NSW and QLD.
7. Permission checks: subcontractor can't see the head contract; user without a module licence sees the upgrade state.
8. AI assistant drafts an RFI from a markup; draft is editable and nothing is submitted until confirmed.

## 3. Conventions

- Tests live next to the code in `__tests__/`; E2E in `apps/web/e2e/`.
- Test data from shared factories in `packages/testing` (also used by mobile and backend seeds).
- MSW handlers generated from the OpenAPI contract so mocks can't drift from the real API.
- Query by role and label, not test ids, which also keeps components accessible.
- No snapshot tests of whole pages; visual tests cover appearance.
- Flaky tests are fixed or deleted within a week, never skipped and forgotten.

## 4. Coverage goals

Coverage is a guide, not a gate: 90% on `packages/domain` (money and legal logic), 70% on features. Every bug fix ships with a test that fails without it.

## 5. Environments

- Preview deployment per PR with a seeded tenant so design and product can review real screens.
- Staging mirrors production config in AWS Sydney; nightly E2E and weekly load tests run there.
