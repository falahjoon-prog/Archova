import { encodeId } from '@archova/domain';
import type { EventView, ItemRow, LogRow, SettingsView } from '../application/eot';
import { eventRef, type Flag } from '../domain/eot';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const num = (v: number | string | null) => (v === null ? null : Number(v));

export const toSettingsDto = (s: SettingsView) => ({
  form: s.form,
  noticeDays: s.noticeDays,
  claimDays: s.claimDays,
  dayBasis: s.dayBasis,
  noticeClause: s.noticeClause,
  claimClause: s.claimClause,
  confirmed: s.confirmed,
  confirmedAt: iso(s.confirmedAt),
  rainThresholdMm: s.rainThresholdMm,
  wetDayAllowance: s.wetDayAllowance,
  isDefault: s.isDefault,
  version: s.version,
});

export const toEventDto = (e: EventView) => ({
  id: encodeId('delayEvent', e.id),
  number: e.number,
  ref: eventRef(e.number),
  title: e.title,
  cause: e.cause,
  status: e.status,
  startedOn: e.startedOn,
  endedOn: e.endedOn,
  awareOn: e.awareOn,
  criticalPath: e.criticalPath,
  summary: e.summary,
  affected: e.affected,
  daysClaimed: e.daysClaimed,
  suggestedDays: e.suggestedDays,
  noticeDueOn: e.noticeDueOn,
  claimDueOn: e.claimDueOn,
  noticeSentOn: e.noticeSentOn,
  noticeRefLabel: e.noticeRefLabel,
  claimSentOn: e.claimSentOn,
  claimRefLabel: e.claimRefLabel,
  assessedOn: e.assessedOn,
  daysGranted: e.daysGranted,
  assessmentNote: e.assessmentNote,
  noticeClock: e.clocks.notice,
  claimClock: e.clocks.claim,
  evidence: e.evidence,
  version: e.version,
});

export const toItemDto = (i: ItemRow) => ({
  id: encodeId('delayEventItem', i.id),
  kind: i.kind,
  sourceKey: i.sourceKey,
  date: i.onDate,
  label: i.label,
  detail: i.detail,
  hours: num(i.hours),
  days: num(i.days),
  rainMm: num(i.rainMm),
});

export const toLogDto = (l: LogRow) => ({
  id: encodeId('delayEventLog', l.id),
  kind: l.kind,
  detail: l.detail,
  at: l.at.toISOString(),
});

export const toFlagDto = (f: Flag) => ({
  kind: f.kind,
  severity: f.severity,
  message: f.message,
  eventId: f.eventId ? encodeId('delayEvent', f.eventId) : null,
});
