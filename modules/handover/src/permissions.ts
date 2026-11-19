import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `handover` (tool `documents`). The close-out pack is the builder's working list and
// goes to the client only when it is issued, so reading needs `standard` (not the read-only client and subcontractor
// templates); keeping it is the builder's admin.
export const HANDOVER_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'handover.items.read', scope: 'project', tool: 'documents', level: 'standard' },
  { key: 'handover.items.manage', scope: 'project', tool: 'documents', level: 'admin' },
];
