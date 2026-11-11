import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `forms`. Anyone on the project can read templates and fill in a form assigned to them
// (`tool: null`; the application layer limits outside users to forms assigned to them). Building templates, assigning
// forms to others and closing submissions follow the `inspections` tool (forms generalise inspection checklists).
export const FORMS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'forms.templates.read', scope: 'project', tool: null, level: 'read' },
  { key: 'forms.templates.manage', scope: 'project', tool: 'inspections', level: 'admin' },
  { key: 'forms.submissions.read', scope: 'project', tool: null, level: 'read' },
  { key: 'forms.submissions.fill', scope: 'project', tool: null, level: 'read' },
  { key: 'forms.submissions.assign', scope: 'project', tool: 'inspections', level: 'standard' },
  { key: 'forms.submissions.close', scope: 'project', tool: 'inspections', level: 'admin' },
];
