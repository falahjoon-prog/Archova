import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `submittals` (tool `submittals`, Sam 02 §2). Subcontractors and consultants hold
// `standard`, so they can submit and return a status; whose turn it is to review is checked in the application
// layer. Closing an approved item needs `admin`.
export const SUBMITTALS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'submittals.submittals.read', scope: 'project', tool: 'submittals', level: 'read' },
  { key: 'submittals.submittals.create', scope: 'project', tool: 'submittals', level: 'standard' },
  { key: 'submittals.submittals.submit', scope: 'project', tool: 'submittals', level: 'standard' },
  { key: 'submittals.submittals.review', scope: 'project', tool: 'submittals', level: 'standard' },
  { key: 'submittals.submittals.close', scope: 'project', tool: 'submittals', level: 'admin' },
];
