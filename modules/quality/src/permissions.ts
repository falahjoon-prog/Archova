import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `quality` (tool `inspections`, Sam 02 §2). Checklists are the builder's to design;
// observations can be raised by anyone with `standard` (a subcontractor flags what they see) and are closed by `admin`.
export const QUALITY_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'quality.templates.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'quality.templates.manage', scope: 'project', tool: 'inspections', level: 'admin' },
  { key: 'quality.inspections.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'quality.inspections.perform', scope: 'project', tool: 'inspections', level: 'standard' },
  { key: 'quality.inspections.close', scope: 'project', tool: 'inspections', level: 'admin' },
  { key: 'quality.observations.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'quality.observations.create', scope: 'project', tool: 'inspections', level: 'standard' },
  { key: 'quality.observations.close', scope: 'project', tool: 'inspections', level: 'admin' },
];
