import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `estimating`. Tender packages and quotes are commercial (they lead to subcontracts),
// so builder-side keys sit on the `commitments` tool rather than a new one. Subcontractors hold `commitments` at
// read, which lets them list the packages they were invited to; submitting a quote needs only project membership
// (`tool: null`) because the application layer already requires the caller's company to be invited (EST-AC3).
export const ESTIMATING_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'estimating.packages.read', scope: 'project', tool: 'commitments', level: 'read' },
  { key: 'estimating.packages.manage', scope: 'project', tool: 'commitments', level: 'admin' },
  { key: 'estimating.quotes.submit', scope: 'project', tool: null, level: 'read' },
  { key: 'estimating.quotes.review', scope: 'project', tool: 'commitments', level: 'admin' },
];
