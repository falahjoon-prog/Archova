import { encodeId } from '@archova/domain';
import type { CheckRow, EventRow, UnitWithQa } from '../application/units';
import type { Flag, Summary } from '../domain/prefab';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const toUnitDto = (u: UnitWithQa) => ({
  id: encodeId('prefabUnit', u.id),
  number: u.number,
  code: u.code,
  name: u.name,
  kind: u.kind,
  factoryName: u.factoryName,
  supplierCompanyId: u.supplierCompanyId ? encodeId('company', u.supplierCompanyId) : null,
  location: u.location,
  installSequence: u.installSequence,
  weightKg: u.weightKg,
  dimensions: u.dimensions,
  status: u.status,
  progressPct: u.progressPct,
  fabStart: u.fabStart,
  fabDue: u.fabDue,
  shipDate: u.shipDate,
  installDate: u.installDate,
  shippedAt: iso(u.shippedAt),
  deliveredAt: iso(u.deliveredAt),
  installedAt: iso(u.installedAt),
  statusReason: u.statusReason,
  deliveryId: u.deliveryId ? encodeId('materialDelivery', u.deliveryId) : null,
  deliveryLabel: u.deliveryLabel,
  notes: u.notes,
  qaTotal: u.qa.total,
  qaDone: u.qa.done,
  qaFailed: u.qa.failed,
  version: u.version,
});

export const toCheckDto = (c: CheckRow) => ({
  id: encodeId('prefabCheck', c.id),
  stage: c.stage,
  label: c.label,
  required: c.required,
  result: c.result,
  note: c.note,
  fileIds: c.fileIds.map((f) => encodeId('file', f)),
  checkedAt: iso(c.checkedAt),
});

export const toEventDto = (e: EventRow) => ({
  id: encodeId('prefabEvent', e.id),
  kind: e.kind,
  detail: e.detail,
  at: e.at.toISOString(),
});

export const toFlagDto = (f: Flag) => ({
  unitId: encodeId('prefabUnit', f.unitId),
  kind: f.kind,
  severity: f.severity,
  message: f.message,
  relatedUnitIds: f.relatedUnitIds.map((i) => encodeId('prefabUnit', i)),
});

export const toSummaryDto = (s: Summary) => ({
  total: s.total,
  byStatus: s.byStatus,
  installedPct: s.installedPct,
  nextInstalls: s.nextInstalls.map((n) => ({
    unitId: encodeId('prefabUnit', n.unitId),
    code: n.code,
    installDate: n.installDate,
  })),
});
