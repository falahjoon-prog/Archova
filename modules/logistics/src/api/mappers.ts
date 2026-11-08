import { encodeId } from '@archova/domain';
import type { DeliveryRow, EventRow, ResourceRow } from '../application/deliveries';
import type { Flag, SlotSuggestion } from '../domain/logistics';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const rid = (id: string | null) => (id ? encodeId('logisticsResource', id) : null);

export const toResourceDto = (r: ResourceRow) => ({
  id: encodeId('logisticsResource', r.id),
  name: r.name,
  kind: r.kind,
  capacity: r.capacity,
  active: r.active,
  note: r.note,
  version: r.version,
});

export const toDeliveryDto = (d: DeliveryRow) => ({
  id: encodeId('materialDelivery', d.id),
  number: d.number,
  title: d.title,
  supplierName: d.supplierName,
  supplierCompanyId: d.supplierCompanyId ? encodeId('company', d.supplierCompanyId) : null,
  supplierContact: d.supplierContact,
  supplierEmail: d.supplierEmail,
  supplierPhone: d.supplierPhone,
  items: d.items,
  windowStart: d.windowStart.toISOString(),
  windowEnd: d.windowEnd.toISOString(),
  zoneId: rid(d.zoneId),
  needsLift: d.needsLift,
  liftResourceId: rid(d.liftResourceId),
  liftStart: iso(d.liftStart),
  liftEnd: iso(d.liftEnd),
  vehicle: d.vehicle,
  accessNotes: d.accessNotes,
  status: d.status,
  arrivedAt: iso(d.arrivedAt),
  unloadedAt: iso(d.unloadedAt),
  statusReason: d.statusReason,
  commitmentId: d.commitmentId ? encodeId('commitment', d.commitmentId) : null,
  commitmentLabel: d.commitmentLabel,
  version: d.version,
});

export const toEventDto = (e: EventRow) => ({
  id: encodeId('materialDeliveryEvent', e.id),
  kind: e.kind,
  detail: e.detail,
  at: e.at.toISOString(),
});

export const toFlagDto = (f: Flag) => ({
  deliveryId: encodeId('materialDelivery', f.deliveryId),
  kind: f.kind,
  severity: f.severity,
  message: f.message,
  relatedDeliveryIds: f.relatedDeliveryIds.map((i) => encodeId('materialDelivery', i)),
});

export const toSlotDto = (s: SlotSuggestion) => ({
  start: s.start.toISOString(),
  end: s.end.toISOString(),
  zoneId: encodeId('logisticsResource', s.zoneId),
  liftResourceId: rid(s.liftResourceId),
  liftEnd: iso(s.liftEnd),
});
