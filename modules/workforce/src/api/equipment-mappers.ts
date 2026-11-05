import { encodeId } from '@archova/domain';
import type { BookingRow, EquipmentRow, LogRow } from '../application/equipment';

export const toEquipmentDto = (e: EquipmentRow) => ({
  id: encodeId('equipment', e.id),
  name: e.name,
  assetNumber: e.assetNumber,
  type: e.type,
  status: e.status,
  version: e.version,
});

export const toBookingDto = (b: BookingRow) => ({
  id: encodeId('equipmentBooking', b.id),
  equipmentId: encodeId('equipment', b.equipmentId),
  startsOn: b.startsOn,
  endsOn: b.endsOn,
  bookedFor: b.bookedFor,
  note: b.note,
  status: b.status,
});

export const toLogDto = (l: LogRow) => ({
  id: encodeId('equipmentLog', l.id),
  equipmentId: encodeId('equipment', l.equipmentId),
  date: l.logDate,
  hours: l.hours,
  operator: l.operator,
  notes: l.notes,
});
