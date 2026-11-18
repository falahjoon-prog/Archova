import { encodeId } from '@archova/domain';
import type { AllocationRow, AssetRow, PlanRow, RecordRow } from '../application/plant';
import type { DueState, PlantFlag } from '../domain/plant';

export const toAssetDto = (a: AssetRow) => ({
  id: encodeId('plantAsset', a.id),
  name: a.name,
  assetNumber: a.assetNumber,
  category: a.category,
  ownership: a.ownership,
  supplier: a.supplier,
  make: a.make,
  model: a.model,
  serialNumber: a.serialNumber,
  dailyRateCents: a.dailyRateCents,
  status: a.status,
  notes: a.notes,
  version: a.version,
});

export const toAllocationDto = (x: { row: AllocationRow; estimatedCostCents: number | null }) => ({
  id: encodeId('plantAllocation', x.row.id),
  assetId: encodeId('plantAsset', x.row.assetId),
  projectId: encodeId('project', x.row.projectId),
  costCodeId: x.row.costCodeId ? encodeId('costCode', x.row.costCodeId) : null,
  startsOn: x.row.startsOn,
  endsOn: x.row.endsOn,
  note: x.row.note,
  status: x.row.status,
  estimatedCostCents: x.estimatedCostCents,
});

export const toPlanDto = (x: { row: PlanRow; state: DueState | null }) => ({
  id: encodeId('plantPlan', x.row.id),
  assetId: encodeId('plantAsset', x.row.assetId),
  title: x.row.title,
  kind: x.row.kind,
  intervalDays: x.row.intervalDays,
  nextDueOn: x.row.nextDueOn,
  lastDoneOn: x.row.lastDoneOn,
  responsible: x.row.responsible,
  active: x.row.active,
  state: x.state,
});

export const toRecordDto = (r: RecordRow) => ({
  id: encodeId('plantRecord', r.id),
  planId: encodeId('plantPlan', r.planId),
  assetId: encodeId('plantAsset', r.assetId),
  doneOn: r.doneOn,
  performedBy: r.performedBy,
  note: r.note,
  costCents: r.costCents,
});

export const toFlagDto = (f: PlantFlag) => ({
  code: f.code,
  severity: f.severity,
  assetId: encodeId('plantAsset', f.assetId),
  subjectId: f.subjectId
    ? encodeId(
        f.code === 'double_booking' || f.code === 'booked_while_unavailable'
          ? 'plantAllocation'
          : 'plantPlan',
        f.subjectId,
      )
    : null,
  message: f.message,
  date: f.date,
});
