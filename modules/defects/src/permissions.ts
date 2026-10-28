import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `defects` (tool `defects`, Sam 02 §2). Which side of a transition the caller is on
// (builder or the assigned company) is decided by the state machine in @archova/domain; these keys say who may
// try at all. Subcontractors hold `standard`, so they can mark their own defects ready or dispute them.
// Closing, rejecting, reassigning and voiding need `admin` (DEF-AC6).
export const DEFECTS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'defects.defects.read', scope: 'project', tool: 'defects', level: 'read' },
  { key: 'defects.defects.create', scope: 'project', tool: 'defects', level: 'standard' },
  { key: 'defects.defects.respond', scope: 'project', tool: 'defects', level: 'standard' },
  { key: 'defects.defects.close', scope: 'project', tool: 'defects', level: 'admin' },
];
