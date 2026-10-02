import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `documents` (Sam 02 §2: tool `documents`). Markups can be drawn by anyone who can
// read the drawing; publishing one to the project, registering and issuing need `standard`.
export const DOCUMENTS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'documents.documents.read', scope: 'project', tool: 'documents', level: 'read' },
  { key: 'documents.documents.manage', scope: 'project', tool: 'documents', level: 'standard' },
  { key: 'documents.folders.restrict', scope: 'project', tool: 'documents', level: 'admin' },
  { key: 'documents.drawings.read', scope: 'project', tool: 'documents', level: 'read' },
  { key: 'documents.drawings.manage', scope: 'project', tool: 'documents', level: 'standard' },
  { key: 'documents.markups.create', scope: 'project', tool: 'documents', level: 'read' },
  { key: 'documents.markups.publish', scope: 'project', tool: 'documents', level: 'standard' },
  { key: 'documents.transmittals.read', scope: 'project', tool: 'documents', level: 'read' },
  { key: 'documents.transmittals.manage', scope: 'project', tool: 'documents', level: 'standard' },
];
