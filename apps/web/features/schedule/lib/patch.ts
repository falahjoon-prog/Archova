import type { KeyDates, UpdateKeyDates } from '../data/api';

export interface SectionDraft {
  id?: string;
  name: string;
  targetDate: string;
  actualDate: string;
}

export interface KeyDatesDraft {
  possessionDate: string;
  pcTarget: string;
  pcActual: string;
  dlpEnd: string;
  ldRatePerDay: string;
  sections: SectionDraft[];
  reason: '' | 'eot_granted' | 'variation' | 'other';
  note: string;
}

export const LD_RATE = /^[0-9]{1,16}(\.[0-9]{1,2})?$/;

export function draftOf(k: KeyDates): KeyDatesDraft {
  return {
    possessionDate: k.possessionDate ?? '',
    pcTarget: k.pcTarget ?? '',
    pcActual: k.pcActual ?? '',
    dlpEnd: k.dlpEnd ?? '',
    ldRatePerDay: k.ldRatePerDay ?? '',
    sections: k.sections.map((s) => ({
      id: s.id,
      name: s.name,
      targetDate: s.targetDate ?? '',
      actualDate: s.actualDate ?? '',
    })),
    reason: '',
    note: '',
  };
}

/** True when a target date that was already set is being changed, which the API wants a reason for (SCH-AC1). */
export function movesTarget(before: KeyDates, d: KeyDatesDraft): boolean {
  if (before.pcTarget !== null && d.pcTarget !== before.pcTarget) return true;
  return before.sections.some((s) => {
    const now = d.sections.find((x) => x.id === s.id);
    return now !== undefined && s.targetDate !== null && (now.targetDate || null) !== s.targetDate;
  });
}

const orNull = (v: string) => (v === '' ? null : v);

/** Only what changed, so an untouched field is never overwritten by someone else's newer edit. */
export function toPatch(before: KeyDates, d: KeyDatesDraft): UpdateKeyDates {
  const patch: UpdateKeyDates = {};
  for (const f of ['possessionDate', 'pcTarget', 'pcActual', 'dlpEnd'] as const)
    if (orNull(d[f]) !== before[f]) patch[f] = orNull(d[f]);
  if (orNull(d.ldRatePerDay) !== before.ldRatePerDay) patch.ldRatePerDay = orNull(d.ldRatePerDay);
  const sections = d.sections.map((s) => ({
    ...(s.id ? { id: s.id } : {}),
    name: s.name.trim(),
    targetDate: orNull(s.targetDate),
    actualDate: orNull(s.actualDate),
  }));
  const same =
    sections.length === before.sections.length &&
    sections.every((s, i) => {
      const b = before.sections[i]!;
      return (
        s.id === b.id &&
        s.name === b.name &&
        s.targetDate === b.targetDate &&
        s.actualDate === b.actualDate
      );
    });
  if (!same) patch.sections = sections;
  if (Object.keys(patch).length === 0) return patch;
  if (d.reason) patch.reason = d.reason;
  if (d.note.trim()) patch.note = d.note.trim();
  return patch;
}
