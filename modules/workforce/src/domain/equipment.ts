import type { EquipmentStatus } from '../infra/tables';

// Equipment register rules (plan: workforce and equipment). Pure.
// Equipment is "in use" exactly when it is at a project; every other status means it is not at one.

export interface EquipmentPlacement {
  status: EquipmentStatus;
  currentProjectId: string | null;
}

export interface PlacementPatch {
  status?: EquipmentStatus;
  /** A project to send it to, or null to take it off site. */
  currentProjectId?: string | null;
}

export type PlacementResult =
  { ok: true; next: EquipmentPlacement } | { ok: false; message: string; path: string };

export function nextPlacement(cur: EquipmentPlacement, patch: PlacementPatch): PlacementResult {
  let status = patch.status ?? cur.status;
  let project =
    patch.currentProjectId === undefined ? cur.currentProjectId : patch.currentProjectId;

  if (patch.status === undefined && patch.currentProjectId !== undefined) {
    // Moving it somewhere puts it to work; taking it off site frees it, unless it is down for maintenance or retired.
    status = project ? 'in_use' : cur.status === 'in_use' ? 'available' : cur.status;
  }
  if (status === 'in_use') {
    if (!project)
      return { ok: false, path: 'currentProjectId', message: 'Equipment in use needs a project.' };
  } else {
    if (patch.status !== undefined && patch.currentProjectId)
      return {
        ok: false,
        path: 'currentProjectId',
        message: 'Only equipment in use can be at a project.',
      };
    project = null;
  }
  return { ok: true, next: { status, currentProjectId: project } };
}
