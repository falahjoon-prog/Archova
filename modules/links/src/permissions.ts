import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `links`. Links belong to the project rather than one tool (`tool: null`), so every active
// project member can see them. What a person sees *through* a link is decided by each linked tool's own permission and
// visibility rules (the `LinkSource` of that tool), so a link never reveals a record the person could not open there.
export const LINKS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'links.links.read', scope: 'project', tool: null, level: 'read' },
  { key: 'links.links.create', scope: 'project', tool: null, level: 'standard' },
  { key: 'links.links.delete', scope: 'project', tool: null, level: 'standard' },
];
