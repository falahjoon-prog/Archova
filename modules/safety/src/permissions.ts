import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `safety` (tool `inspections`, no separate tool yet). A subcontractor holds `standard`, so
// they submit and revise their own company's SWMS and acknowledge accepted ones. Reviewing is the builder's `admin`.
export const SAFETY_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'safety.swms.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'safety.swms.submit', scope: 'project', tool: 'inspections', level: 'standard' },
  { key: 'safety.swms.acknowledge', scope: 'project', tool: 'inspections', level: 'standard' },
  { key: 'safety.swms.review', scope: 'project', tool: 'inspections', level: 'admin' },
  // Incidents: anyone on site reports; the builder's admin manages, investigates and sees injury details.
  { key: 'safety.incidents.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'safety.incidents.report', scope: 'project', tool: 'inspections', level: 'standard' },
  { key: 'safety.incidents.manage', scope: 'project', tool: 'inspections', level: 'admin' },
  { key: 'safety.incidents.view_medical', scope: 'project', tool: 'inspections', level: 'admin' },
];
