// Which module events change a record Nova has indexed (backend 08 §2), and which kind of record each one names.
// The record is the event's entity: the RFI, the defect or the diary day.

/** The records Nova reads besides documents and drawings; each is one page of text per record. */
export type RecordKind = 'rfi' | 'defect' | 'diary';

/** Every event type that can change a record's text or whether it is a source at all (a send, a void, a sign-off). */
export const RECORD_EVENT_TYPES = ['rfis.rfi.*', 'defects.defect.*', 'diary.entry.*'] as const;

const PREFIXES: ReadonlyArray<readonly [prefix: string, kind: RecordKind]> = [
  ['rfis.rfi.', 'rfi'],
  ['defects.defect.', 'defect'],
  ['diary.entry.', 'diary'],
];

/** The kind of record an event of this type is about; null for any other event. */
export function recordKindOf(eventType: string): RecordKind | null {
  return PREFIXES.find(([prefix]) => eventType.startsWith(prefix))?.[1] ?? null;
}
