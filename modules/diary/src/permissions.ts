import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `diary` (tool `diary`, Sam 02 §4). Site managers and PMs hold `admin`, so they
// write, submit, amend and sign off; superintendents read; subcontractors read their own labour only
// (company-scoped in the application layer).
export const DIARY_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'diary.entries.read', scope: 'project', tool: 'diary', level: 'read' },
  { key: 'diary.entries.write', scope: 'project', tool: 'diary', level: 'standard' },
  { key: 'diary.entries.sign_off', scope: 'project', tool: 'diary', level: 'admin' },
];
