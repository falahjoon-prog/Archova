import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `workforce` (tool `workforce`, backend schema/workforce.md §Permissions).
// Anyone on the project can sign themselves in. Subcontractors (`standard`, company-scoped) see the
// headcount and manage their own workers; site managers (`admin`) run sites, gates, manual sign-ins and
// roll calls, and can admit a blocked worker.
export const WORKFORCE_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'workforce.attendance.sign_in_self', scope: 'project', tool: 'workforce', level: 'read' },
  { key: 'workforce.attendance.view', scope: 'project', tool: 'workforce', level: 'standard' },
  { key: 'workforce.workers.manage', scope: 'project', tool: 'workforce', level: 'standard' },
  { key: 'workforce.attendance.manage', scope: 'project', tool: 'workforce', level: 'admin' },
  { key: 'workforce.attendance.override', scope: 'project', tool: 'workforce', level: 'admin' },
  { key: 'workforce.workers.view_personal', scope: 'project', tool: 'workforce', level: 'admin' },
  // Site managers build and publish the site induction (product/14 I1, I7).
  { key: 'workforce.inductions.manage', scope: 'project', tool: 'workforce', level: 'admin' },
  // Subcontractor compliance wallet (compliance/05, E5): an org's own insurance, licence and card evidence.
  // Org-level because the documents belong to the company, not to a project.
  { key: 'workforce.wallet.view', scope: 'org', tool: null, level: 'standard' },
  { key: 'workforce.wallet.manage', scope: 'org', tool: null, level: 'admin' },
  // Wallet sharing: a builder asks for access and reads what it is granted; the subbie accepts and revokes
  // with `wallet.manage`.
  { key: 'workforce.wallet.request', scope: 'org', tool: null, level: 'admin' },
  { key: 'workforce.wallet.read_granted', scope: 'org', tool: null, level: 'standard' },
];
