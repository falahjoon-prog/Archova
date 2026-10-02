// Pure diary rules shared by the screen, the preview source and tests.

import { addDays, isBusinessDay, zonedToUtc, type LocalDate } from '@archova/time';
import type { DelayType, DiaryContent, DiaryDaySummary, DiaryEntry } from './types';

/** Names a company id; the screens pass the project directory's lookup. */
export type CompanyNamer = (id: string | null | undefined) => string;

/** DIA-AC4: "possible EOT" is ticked by default for weather, client, design and authority delays. */
export function eotByDefault(type: DelayType): boolean {
  return type === 'weather' || type === 'client' || type === 'design' || type === 'authority';
}

export function labourTotals(content: Pick<DiaryContent, 'labour'>) {
  return content.labour.reduce(
    (t, l) => ({ headcount: t.headcount + (l.headcount ?? 0), hours: t.hours + (l.hours ?? 0) }),
    { headcount: 0, hours: 0 },
  );
}

/** DIA-AC7: late when submitted after the cut-off (default 10:00 the next day, project time). */
export function isLateSubmission(
  date: LocalDate,
  submittedAt: Date,
  timeZone: string,
  cutoff = '10:00',
): boolean {
  return submittedAt.getTime() > zonedToUtc(addDays(date, 1), cutoff, timeZone).getTime();
}

/** Lines copied into a new day: yesterday's companies and trades, headcount and hours blank (DIA-AC3). */
export function copyLabour(
  prev: DiaryContent['labour'],
  newId: () => string,
): DiaryContent['labour'] {
  return prev.map((l) => ({
    id: newId(),
    companyId: l.companyId,
    trade: l.trade,
    headcount: null,
    hours: null,
  }));
}

/** Days from `from` to `to` (inclusive), newest first, with business days that have no entry marked missing. */
export function dayStrip(
  entries: ReadonlyArray<Pick<DiaryEntry, 'date' | 'status' | 'late' | 'amendments'>>,
  from: LocalDate,
  to: LocalDate,
): DiaryDaySummary[] {
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const out: DiaryDaySummary[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const e = byDate.get(d);
    if (e)
      out.push({ date: d, status: e.status, late: e.late, amendmentCount: e.amendments.length });
    else if (isBusinessDay(d))
      out.push({ date: d, status: 'missing', late: false, amendmentCount: 0 });
  }
  return out;
}

const n = (v: number | null | undefined) => (v === null || v === undefined ? 'blank' : String(v));
const txt = (v: string) => (v.trim() ? v.trim() : 'blank');

/**
 * Human-readable before → after list for an amendment (`diary.amendments.changes`). Lines are matched by id, so a
 * changed headcount reads as one change, not a removal and an addition.
 */
export function diffContent(
  before: DiaryContent,
  after: DiaryContent,
  companyName: CompanyNamer,
): Array<{ field: string; before: string; after: string }> {
  const out: Array<{ field: string; before: string; after: string }> = [];
  const push = (field: string, b: string, a: string) => {
    if (b !== a) out.push({ field, before: b, after: a });
  };

  push('Weather notes', txt(before.weatherNotes), txt(after.weatherNotes));
  push(
    'Site stood down',
    before.standDown.active ? 'Yes' : 'No',
    after.standDown.active ? 'Yes' : 'No',
  );
  push('Notes', txt(before.notes), txt(after.notes));
  push('Photos', String(before.photoIds.length), String(after.photoIds.length));

  const lines = <L extends { id: string }>(
    section: string,
    b: L[],
    a: L[],
    label: (l: L) => string,
    fields: Array<[string, (l: L) => string]>,
  ) => {
    const prev = new Map(b.map((l) => [l.id, l]));
    for (const l of a) {
      const old = prev.get(l.id);
      if (!old) {
        out.push({ field: `${section}`, before: 'none', after: label(l) });
        continue;
      }
      for (const [name, get] of fields) push(`${section} · ${label(l)} ${name}`, get(old), get(l));
      prev.delete(l.id);
    }
    for (const old of prev.values())
      out.push({ field: section, before: label(old), after: 'removed' });
  };

  lines('Labour', before.labour, after.labour, (l) => companyName(l.companyId), [
    ['headcount', (l) => n(l.headcount)],
    ['hours', (l) => n(l.hours)],
    ['trade', (l) => txt(l.trade)],
  ]);
  lines('Plant', before.plant, after.plant, (l) => txt(l.description), [
    ['quantity', (l) => String(l.quantity)],
    ['hours', (l) => n(l.hours)],
    ['status', (l) => l.status],
  ]);
  lines('Deliveries', before.deliveries, after.deliveries, (l) => txt(l.description), [
    ['docket', (l) => txt(l.docketNumber)],
    ['supplier', (l) => txt(l.supplier)],
  ]);
  lines('Visitors', before.visitors, after.visitors, (l) => txt(l.name), [
    ['company', (l) => txt(l.company)],
    ['purpose', (l) => txt(l.purpose)],
  ]);
  lines('Delays', before.delays, after.delays, (l) => txt(l.description), [
    ['hours', (l) => n(l.hours)],
    ['type', (l) => l.type],
    ['possible EOT', (l) => (l.isEotCandidate ? 'Yes' : 'No')],
  ]);
  return out;
}

/** What blocks submit: delays need type, hours and description (DIA-AC4); labour lines need a headcount. */
export function submitProblems(content: DiaryContent, companyName: CompanyNamer): string[] {
  const problems: string[] = [];
  content.delays.forEach((d, i) => {
    if (!d.description.trim() || d.hours === null) {
      problems.push(`Delay ${i + 1} needs hours and a description.`);
    }
  });
  content.labour.forEach((l) => {
    if (l.headcount === null)
      problems.push(`Add a headcount for ${companyName(l.companyId)}, or remove the line.`);
  });
  return problems;
}
