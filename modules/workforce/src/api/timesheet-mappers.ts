import { encodeId } from '@archova/domain';
import type { LineRow, Sheet } from '../application/timesheet';
import { hoursOf, totalMinutes } from '../domain/timesheet';

export const toLineDto = (l: LineRow) => ({
  id: encodeId('timesheetLine', l.id),
  minutes: l.minutes,
  breakMinutes: l.breakMinutes,
  costCodeId: l.costCodeId ? encodeId('costCode', l.costCodeId) : null,
  source: l.source,
  adjustedReason: l.adjustedReason,
});

export const toTimesheetDto = (d: Sheet) => ({
  id: encodeId('timesheet', d.sheet.id),
  workerId: encodeId('worker', d.sheet.workerId),
  companyId: d.sheet.companyId ? encodeId('company', d.sheet.companyId) : null,
  date: d.sheet.localDate,
  status: d.sheet.status,
  submittedAt: d.sheet.submittedAt ? d.sheet.submittedAt.toISOString() : null,
  approvedAt: d.sheet.approvedAt ? d.sheet.approvedAt.toISOString() : null,
  rejectionReason: d.sheet.rejectionReason,
  paidMinutes: totalMinutes(d.lines),
  paidHours: hoursOf(totalMinutes(d.lines)),
  lines: d.lines.map(toLineDto),
});
