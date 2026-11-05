import { encodeId } from '@archova/domain';
import type { AssignmentRow, ShiftRow } from '../application/roster';

export const toAssignmentDto = (a: AssignmentRow) => ({
  id: encodeId('shiftAssignment', a.id),
  shiftId: encodeId('shift', a.shiftId),
  workerId: encodeId('worker', a.workerId),
  companyId: a.companyId ? encodeId('company', a.companyId) : null,
  status: a.status,
  notifiedAt: a.notifiedAt ? a.notifiedAt.toISOString() : null,
  respondedAt: a.respondedAt ? a.respondedAt.toISOString() : null,
});

export const toShiftDto = (d: {
  shift: ShiftRow;
  assignments: AssignmentRow[];
  filled: number;
}) => ({
  id: encodeId('shift', d.shift.id),
  siteId: encodeId('workforceSite', d.shift.siteId),
  crew: d.shift.crew,
  trade: d.shift.trade,
  note: d.shift.note,
  startsAt: d.shift.startsAt.toISOString(),
  endsAt: d.shift.endsAt.toISOString(),
  requiredHeadcount: d.shift.requiredHeadcount,
  filled: d.filled,
  status: d.shift.status,
  publishedAt: d.shift.publishedAt ? d.shift.publishedAt.toISOString() : null,
  assignments: d.assignments.map(toAssignmentDto),
});
