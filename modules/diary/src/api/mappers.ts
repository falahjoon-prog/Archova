import { encodeId, type IdKind } from '@archova/domain';
import type { DiaryAmendment, DiaryEntry, DiaryEntryDetail } from '@archova/contracts';
import { ID_FIELDS, type LineKind } from '../domain/diary';
import type { AmendmentRow, EntryDetail, EntryView, LineRow } from '../application/diary';

export const LINE_ID_KIND: Record<LineKind, IdKind> = {
  labour: 'diaryLabour',
  plant: 'diaryPlant',
  delivery: 'diaryDelivery',
  delay: 'diaryDelay',
  visitor: 'diaryVisitor',
  event: 'diaryEvent',
  stand_down: 'diaryStandDown',
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);

export const toEntryDto = (e: EntryView): DiaryEntry => ({
  id: encodeId('diary', e.id),
  projectId: encodeId('project', e.projectId),
  date: e.date,
  status: e.status,
  weather: e.weather ?? null,
  weatherStationId: e.weatherStationId,
  weatherOverride: e.weatherOverride ?? null,
  weatherNotes: e.weatherNotes,
  siteConditions: e.siteConditions,
  notes: e.notesText || null,
  fileIds: e.fileIds.map((f) => encodeId('file', f)),
  submittedBy: userOrNull(e.submittedBy),
  submittedAt: iso(e.submittedAt),
  submitReceivedAt: iso(e.submitReceivedAt),
  isLate: e.isLate,
  lateAfter: e.lateAfter.toISOString(),
  signedOffBy: userOrNull(e.signedOffBy),
  signedOffAt: iso(e.signedOffAt),
  totals: e.totals,
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
  version: e.version,
});

const HIDDEN = new Set([
  'orgId',
  'deletedAt',
  'createdBy',
  'updatedBy',
  'costCodeId',
  'locationId',
  'related',
]);

/** A child line as the API shows it: prefixed ids, `HH:mm` times, ISO instants. */
export function toLineDto(kind: LineKind, r: LineRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (HIDDEN.has(k)) continue;
    const idKind = ID_FIELDS[k as keyof typeof ID_FIELDS];
    if (k === 'id') out.id = encodeId(LINE_ID_KIND[kind], v as string);
    else if (k === 'projectId') out.projectId = encodeId('project', v as string);
    else if (k === 'entryId') out.entryId = encodeId('diary', v as string);
    else if (idKind && v !== null)
      out[k] = Array.isArray(v)
        ? v.map((x: string) => encodeId(idKind, x))
        : encodeId(idKind, v as string);
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(v)) out[k] = v.slice(0, 5);
    else out[k] = v;
  }
  return out;
}

export const toAmendmentDto = (a: AmendmentRow): DiaryAmendment => ({
  id: encodeId('diaryAmendment', a.id),
  targetType: a.targetType,
  targetId: encodeId(a.targetType === 'entry' ? 'diary' : LINE_ID_KIND[a.targetType], a.targetId),
  action: a.action,
  changes: a.changes,
  reason: a.reason,
  amendedBy: userOrNull(a.amendedBy),
  amendedAt: a.amendedAt.toISOString(),
});

export const toDetailDto = (d: EntryDetail): DiaryEntryDetail =>
  ({
    entry: toEntryDto(d.entry),
    labour: d.lines.labour.map((r) => toLineDto('labour', r)),
    plant: d.lines.plant.map((r) => toLineDto('plant', r)),
    deliveries: d.lines.delivery.map((r) => toLineDto('delivery', r)),
    delays: d.lines.delay.map((r) => toLineDto('delay', r)),
    visitors: d.lines.visitor.map((r) => toLineDto('visitor', r)),
    events: d.lines.event.map((r) => toLineDto('event', r)),
    standDowns: d.lines.stand_down.map((r) => toLineDto('stand_down', r)),
    amendments: d.amendments.map(toAmendmentDto),
  }) as DiaryEntryDetail;
