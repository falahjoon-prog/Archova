import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `esign`. Envelopes carry project documents, so they ride on the `documents` tool:
// anyone who can read documents can see where an envelope stands, `standard` builds and sends one, and `admin` can
// void a sent envelope. Recipients never hold these: they act through their emailed link (X45).
export const ESIGN_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'esign.envelopes.read', scope: 'project', tool: 'documents', level: 'read' },
  { key: 'esign.envelopes.write', scope: 'project', tool: 'documents', level: 'standard' },
  { key: 'esign.envelopes.send', scope: 'project', tool: 'documents', level: 'standard' },
  { key: 'esign.envelopes.void', scope: 'project', tool: 'documents', level: 'admin' },
];
