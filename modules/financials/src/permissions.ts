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
];
