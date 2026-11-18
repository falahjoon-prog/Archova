import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `logistics` (tool `workforce`, the same tool as equipment and rosters). Anyone on the project can see the delivery board; site
// staff log arrivals; coordinators (`admin`) book, move, cancel and keep the list of docks and cranes.
export const LOGISTICS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'logistics.deliveries.view', scope: 'project', tool: 'workforce', level: 'standard' },
  { key: 'logistics.deliveries.checkin', scope: 'project', tool: 'workforce', level: 'standard' },
  { key: 'logistics.deliveries.manage', scope: 'project', tool: 'workforce', level: 'admin' },
];
