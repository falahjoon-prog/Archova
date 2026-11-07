import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `financials`. Contracts and claims are commercial, so everything sits at `standard` or
// above on `payment_claims`: subcontractors (read) never see another company's contract. A payee-scoped view for
// subcontractors (CLM-AC11) is a later increment. Assessing and issuing a payment schedule is `admin`, because a
// late or unreasoned schedule can make the builder liable for the full claim.
export const FINANCIALS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'financials.contracts.read', scope: 'project', tool: 'payment_claims', level: 'standard' },
  { key: 'financials.contracts.manage', scope: 'project', tool: 'payment_claims', level: 'admin' },
  { key: 'financials.claims.read', scope: 'project', tool: 'payment_claims', level: 'standard' },
  { key: 'financials.claims.record', scope: 'project', tool: 'payment_claims', level: 'standard' },
  { key: 'financials.claims.assess', scope: 'project', tool: 'payment_claims', level: 'admin' },
  {
    key: 'financials.variations.manage',
    scope: 'project',
    tool: 'payment_claims',
    level: 'standard',
  },
  { key: 'financials.forecast.read', scope: 'project', tool: 'payment_claims', level: 'admin' },
  { key: 'financials.forecast.manage', scope: 'project', tool: 'payment_claims', level: 'admin' },
  { key: 'financials.retention.manage', scope: 'project', tool: 'payment_claims', level: 'admin' },
  { key: 'financials.trust.manage', scope: 'project', tool: 'payment_claims', level: 'admin' },
  { key: 'financials.variations.decide', scope: 'project', tool: 'payment_claims', level: 'admin' },
  // Budgets are the builder's cost position (margin included), so the budget tool is admin-only by default and the
  // client and subcontractor templates have none (permission templates).
  { key: 'financials.budget.read', scope: 'project', tool: 'budget', level: 'standard' },
  { key: 'financials.budget.manage', scope: 'project', tool: 'budget', level: 'admin' },
  { key: 'financials.budget.view_margin', scope: 'project', tool: 'budget', level: 'admin' },
  // Commitments are the builder's cost position too; staff only (the use cases also refuse outsiders).
  {
    key: 'financials.commitments.read',
    scope: 'project',
    tool: 'payment_claims',
    level: 'standard',
  },
  {
    key: 'financials.commitments.manage',
    scope: 'project',
    tool: 'payment_claims',
    level: 'standard',
  },
  {
    key: 'financials.commitments.decide',
    scope: 'project',
    tool: 'payment_claims',
    level: 'admin',
  },
  // Direct costs post to the budget, so they sit on the budget tool (admin-only by default).
  { key: 'financials.direct_costs.read', scope: 'project', tool: 'budget', level: 'standard' },
  // Site supervisors log quantity in place against the production plan; the plan itself needs budget.manage.
  { key: 'financials.production.log', scope: 'project', tool: 'budget', level: 'standard' },
  { key: 'financials.direct_costs.manage', scope: 'project', tool: 'budget', level: 'standard' },
];
