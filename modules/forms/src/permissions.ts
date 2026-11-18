import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `forms` (tool `inspections`, like the other field-safety records). Anyone who can fill in
// inspections can fill in a form, including a subcontractor; templates are the organisation's admins to build.
export const FORMS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'forms.templates.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'forms.forms.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'forms.forms.fill', scope: 'project', tool: 'inspections', level: 'standard' },
  { key: 'forms.templates.manage', scope: 'org', tool: null, level: 'admin' },
];
