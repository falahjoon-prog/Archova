import { localDateOf, zonedParts, zonedToUtc } from '@archova/time';

/** `2026-11-05T14:30` (a datetime-local value) read as project time, as an instant. Null when blank or invalid. */
export function projectLocalToIso(value: string, timeZone: string): string | null {
  const [date, time] = value.split('T');
  if (!date || !time) return null;
  try {
    return zonedToUtc(date, time.slice(0, 5), timeZone).toISOString();
  } catch {
    return null;
  }
}

/** An instant as a datetime-local value in project time. */
export function isoToProjectLocal(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  const p = zonedParts(iso, timeZone);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** The current project time as a datetime-local value, for "now". */
export function nowProjectLocal(timeZone: string, now: Date = new Date()): string {
  return isoToProjectLocal(now.toISOString(), timeZone);
}

export { localDateOf };
