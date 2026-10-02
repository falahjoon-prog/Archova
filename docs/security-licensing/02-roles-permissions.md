# 02. Roles and permissions

Owner: Sam. Status: draft v1, 2 Oct 2026.
Related: [01 authentication](01-authentication-sso.md), [03 tenant isolation](03-tenant-isolation.md), [06 license enforcement](06-license-enforcement.md).

## 1. The problem we're solving

Construction projects are multi-company by nature. On one project the builder's staff, 40 subcontractors, an architect, engineers, a superintendent and the client all need different slices of the same data:

- A subcontractor sees drawings and RFIs relevant to them, their own defects, their own payment claims. Never another subbie's claim amounts.
- The superintendent approves variations and issues payment schedules on the head contract only.
- The client sees progress, not the builder's margins or subcontract values.
- Some items are private (a commercial RFI, an incident report with health information).

So permissions have to work at three levels: **organisation**, **project**, and **individual item**.

## 2. Concepts

| Concept | Meaning |
|---|---|
| Organisation (tenant) | The paying customer (usually a builder). Owns projects. |
| Company | An entity in a project directory (builder, subcontractor, consultant, client). A company may or may not have its own organisation account. |
| Tool | A functional area: Documents, Drawings, RFIs, Submittals, Diary, Defects, Inspections, Incidents, Budget, Commitments, Variations, Payment Claims, Directory, Admin, etc. Matches the module list in the plan. |
| Permission level | Per tool: `none`, `read`, `standard`, `admin` (same mental model Procore users already know). |
| Granular permission | Fine-grained overrides on top of a level, e.g. `rfis.create` for a read-only user, `payment_claims.approve`, `budget.view_margin`. |
| Permission template | A named bundle of tool levels + granular permissions. Org-defined, reusable across projects (e.g. "Project Manager", "Site Manager", "Subcontractor", "Superintendent", "Client"). |
| Company-scoped visibility | Rules that limit a user to records linked to their own company (their claims, defects assigned to their company, their commitments). |
| Item privacy | Per record: `private` flag + explicit distribution list. |

## 3. Levels of assignment

```
Org level      Membership.role_template_id           -> company-level tools (Directory, Portfolio, Org Admin, Billing, Templates, Reports)
Project level  ProjectMember.permission_template_id  -> project tools (RFIs, Drawings, Diary, Financials ...)
Item level     record.is_private + record.distribution[] -> who can see this specific item
```

Org roles (fixed set, plus custom templates for project tools). Matches Ava's Owner/Admin/Member/Guest, with Billing admin added:

| Org role | Can do |
|---|---|
| Owner | Everything, including billing, SSO, deleting the org. At least one required, two recommended. |
| Admin | Everything except billing ownership transfer and deleting the org. |
| Billing admin | Billing, invoices, plan changes only. |
| Member | Access only to projects they're added to, with their project template. |
| External collaborator | Implicit: a user whose company is in a project directory but who isn't a member of this org. Project-level access only, never org tools. Free (see doc 04). |

## 4. Default permission templates (seeded per org, editable)

| Tool | Proj. Admin | PM | Site Manager | Subcontractor | Consultant | Superintendent | Client |
|---|---|---|---|---|---|---|---|
| Documents / Drawings | admin | admin | standard | read | standard | read | read |
| RFIs | admin | admin | standard | standard (own) | standard | read | none |
| Submittals | admin | admin | standard | standard (own) | standard | read | none |
| Site diary | admin | admin | admin | read (own labour) | none | read | none |
| Defects | admin | admin | admin | standard (own company) | read | read | read |
| Inspections / Safety | admin | admin | admin | standard (own) | none | read | none |
| Incidents | admin | standard | standard | none | none | none | none |
| Budget / Cost | admin | admin | none | none | none | none | none |
| Commitments (subcontracts) | admin | admin | read | read (own company) | none | none | none |
| Variations (head contract) | admin | admin | none | none | none | standard + approve | read |
| Payment claims | admin | admin | none | standard (own company) | none | standard + issue schedule | read (head contract) |
| Directory | admin | admin | standard | read | read | read | read |

"(own)" means company-scoped visibility (§6).

## 5. Permission evaluation

Single function, used everywhere (web, mobile API, public API, background jobs, AI assistant tools):

```
can(principal, action, resource) -> allow | deny (+ reason)
```

Order of evaluation, first deny wins:

1. **Authenticated & session valid** (doc 01).
2. **Tenant check:** resource's `org_id` resolved; principal has a Membership in that org *or* a ProjectMember row on the resource's project. Otherwise deny. (Doc 03 enforces the same at the database.)
3. **Entitlement check:** the owning org's license includes the module the tool belongs to and is in a usable state (doc 06). Read-only states downgrade write actions to deny.
4. **Org-level policy:** e.g. org requires MFA and session lacks it → deny with `mfa_required`.
5. **Tool level** from the user's template for that project, plus granular overrides.
6. **Company scoping:** if the template marks the tool as company-scoped, resource's company must equal user's company on that project.
7. **Item privacy:** private items require the user to be on the distribution list, the creator, or a tool admin.
8. **State rules:** e.g. a payment claim that's been submitted is immutable for the claimant; a closed RFI accepts no new responses unless reopened.

Rules:
- Default deny. A missing rule is a deny.
- Server-side only. The UI and mobile app *hide* things using a permissions summary from the API, but every request is re-checked server-side.
- Lists are filtered in the query (SQL `WHERE` built from the permission context), never fetched-then-filtered, or pagination and counts leak.
- Search, exports, notifications, email digests, webhooks and AI answers all go through the same check. These are the classic leak points.

## 6. Company scoping detail

Many records carry a company reference: `Defect.assignee_company_id`, `Commitment.payee_company_id`, `PaymentClaim` via contract payee, `DiaryLabour.company_id`, `RFI.assignee`'s company. The scoping rule per tool states which column applies. A subcontractor user with "standard (own)" on Payment Claims can create and view claims only on contracts where their company is payee.

## 7. Performance at scale

- On first request for (user, project), compute an **effective permission set** (tool levels, granular flags, company id, scoping flags). Cache in Redis: key `perm:{user}:{project}:{version}`, TTL 15 min.
- Invalidate by bumping a version number on: template edit (bump org version), member role change (bump project-member version), membership removal, license change (bump org entitlement version). Version lookup is a single Redis `MGET`.
- Item privacy and company scoping are applied in SQL with indexed columns (`project_id, company_id`, `project_id, is_private`), so they scale with normal query plans.
- Target: permission check adds < 2 ms p95 per request.

## 8. Auditing permission changes

Every change to memberships, templates, granular overrides, distribution lists and SSO group mappings is written to the security audit log (doc 07) with before/after values. Org admins can view "who has access to project X and why" (a computed report showing the template and overrides behind each user's access).

## 9. AI assistant

The AI assistant acts **as the user**. Every retrieval and tool call it makes passes through `can()` with the user's principal. It can never read a document the user couldn't open themselves, and it never sends or submits anything. Following Ari's rules (`docs/ai/04` §7), it does not write payment claim or payment schedule wording at all. See doc 09 §6.

## 10. Open items

- Confirm template defaults with a pilot builder.
- Decide whether consultants/clients can be granted org-level read across a portfolio (owner-portal phase 5).
