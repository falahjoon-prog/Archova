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
  // Takeoff is builder-side working data: standard commitments access, so subcontractors (read) never reach it.
  { key: 'estimating.takeoff.read', scope: 'project', tool: 'commitments', level: 'standard' },
  { key: 'estimating.takeoff.manage', scope: 'project', tool: 'commitments', level: 'standard' },
  { key: 'estimating.takeoff.confirm', scope: 'project', tool: 'commitments', level: 'admin' },
  // Estimates are builder-side commercial working data, like takeoff. Issuing freezes the tender price.
  { key: 'estimating.estimates.read', scope: 'project', tool: 'commitments', level: 'standard' },
  { key: 'estimating.estimates.manage', scope: 'project', tool: 'commitments', level: 'standard' },
  { key: 'estimating.estimates.issue', scope: 'project', tool: 'commitments', level: 'admin' },
  // The bid board spans projects, so it is an org permission for staff; each project on it is then filtered by
  // `estimating.quotes.review`, so a project the caller cannot review quotes on never shows prices.
  { key: 'estimating.board.read', scope: 'org', tool: null, level: 'read', orgRoles: ['member'] },
  // Bidder lists are the company's own working lists of subcontractors, so staff only, like the cost library.
  { key: 'estimating.bidders.read', scope: 'org', tool: null, level: 'read', orgRoles: ['member'] },
  {
    key: 'estimating.bidders.manage',
    scope: 'org',
    tool: null,
    level: 'admin',
    orgRoles: ['member'],
  },
  // The cost library belongs to the company, not a project. Staff (members) read and keep it; external users never
  // hold an org role, so subcontractors cannot see the builder's rates.
  { key: 'estimating.library.read', scope: 'org', tool: null, level: 'read', orgRoles: ['member'] },
  {
    key: 'estimating.library.manage',
    scope: 'org',
    tool: null,
    level: 'admin',
    orgRoles: ['member'],
  },
];
