import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `estimating`. Tender packages and quotes are commercial (they lead to subcontracts),
// so every key sits on the `commitments` tool rather than a new one. Subcontractors hold `commitments` at read, which
// is enough to list the packages they were invited to and to submit a quote; the application layer requires the
// caller's company to be invited (EST-AC3). `quotes.submit` is also the quote-PDF upload permission, so it must not
// reach people with no commitments access. Competing prices are builder-side `quotes.review` only.
export const ESTIMATING_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'estimating.packages.read', scope: 'project', tool: 'commitments', level: 'read' },
  { key: 'estimating.packages.manage', scope: 'project', tool: 'commitments', level: 'admin' },
  { key: 'estimating.quotes.submit', scope: 'project', tool: 'commitments', level: 'read' },
  { key: 'estimating.quotes.review', scope: 'project', tool: 'commitments', level: 'admin' },
];
