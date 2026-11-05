import { encodeId } from '@archova/domain';
import type { EquipmentLogRow, EquipmentView } from '../application/equipment';

export const toEquipmentDto = (e: EquipmentView) => ({
  id: encodeId('equipment', e.id),
  name: e.name,
  assetNumber: e.assetNumber,
  type: e.type,
  status: e.status,
  currentProjectId: e.currentProjectId ? encodeId('project', e.currentProjectId) : null,
  notes: e.notes,
  totalHours: e.totalHours,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
});

export const toEquipmentLogDto = (l: EquipmentLogRow) => ({
  id: encodeId('equipmentLog', l.id),
  equipmentId: encodeId('equipment', l.equipmentId),
  projectId: encodeId('project', l.projectId),
  loggedOn: l.loggedOn,
  hours: l.hours,
  operator: l.operator,
  notes: l.notes,
  recordedAt: l.recordedAt.toISOString(),
});
