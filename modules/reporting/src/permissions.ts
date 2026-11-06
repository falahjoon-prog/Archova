import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `reporting`. Portfolio and reports span projects, so they are org permissions held by staff
// (members); external users never hold an org role. Each project's numbers and rows are then narrowed by that
// project's own tool permission (rfis.rfis.read and so on), so the portfolio never shows what a person could not open.
export const REPORTING_PERMISSIONS: readonly PermissionDefinition[] = [
  {
    key: 'reporting.portfolio.read',
    scope: 'org',
    tool: null,
    level: 'read',
    orgRoles: ['member'],
  },
  {
    key: 'reporting.readiness.read',
    scope: 'org',
    tool: null,
    level: 'read',
    orgRoles: ['member'],
  },
  { key: 'reporting.reports.read', scope: 'org', tool: null, level: 'read', orgRoles: ['member'] },
  {
    key: 'reporting.reports.manage',
    scope: 'org',
    tool: null,
    level: 'standard',
    orgRoles: ['member'],
  },
  // The project risk register. Held per project through the coordination tool, so subcontractors and clients never
  // see the builder's risks.
  { key: 'reporting.risks.read', scope: 'project', tool: 'coordination', level: 'read' },
  { key: 'reporting.risks.write', scope: 'project', tool: 'coordination', level: 'standard' },
  { key: 'reporting.risks.manage', scope: 'project', tool: 'coordination', level: 'admin' },
];
