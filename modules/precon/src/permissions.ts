import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `precon` (phase 4). Prequalification is the builder's company-wide register, so every key
// is org scoped. Templates are designed by admins; anyone with `standard` can record a company's answers; only an
// admin decides, and the decision is always a person's (privacy 06: no automated decisions about a company's work).
export const PRECON_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'precon.templates.manage', scope: 'org', tool: null, level: 'admin' },
  { key: 'precon.prequal.view', scope: 'org', tool: null, level: 'standard' },
  { key: 'precon.prequal.manage', scope: 'org', tool: null, level: 'standard' },
  { key: 'precon.prequal.decide', scope: 'org', tool: null, level: 'admin' },
];
