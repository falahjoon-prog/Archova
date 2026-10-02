import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `rfis` (tool `rfis`, Sam 02 §2). Subcontractors and consultants hold `standard`,
// so they can draft and respond; sending an RFI to the consultant is the builder's call and is checked in the
// application layer (external collaborators can't open one). Closing, voiding and reopening need `admin`.
export const RFIS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'rfis.rfis.read', scope: 'project', tool: 'rfis', level: 'read' },
  { key: 'rfis.rfis.create', scope: 'project', tool: 'rfis', level: 'standard' },
  { key: 'rfis.rfis.respond', scope: 'project', tool: 'rfis', level: 'standard' },
  { key: 'rfis.rfis.open', scope: 'project', tool: 'rfis', level: 'standard' },
  { key: 'rfis.rfis.close', scope: 'project', tool: 'rfis', level: 'admin' },
];
