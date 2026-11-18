// Nova's rule-based flags on forms (no model): who signed a form without being signed in to site that day, and a
// recurring form that is overdue while the crew is on site. Nothing is blocked; a person decides.

export interface AttendanceRow {
  localDate: string;
  fullName: string;
}

/** Same person, loosely: case, spacing and punctuation are ignored. */
export const normaliseName = (n: string) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Signers who have no site sign-in on the form's date. */
export function signersNotOnSite(
  signers: readonly string[],
  formDate: string,
  attendance: readonly AttendanceRow[],
): string[] {
  const present = new Set(
    attendance.filter((a) => a.localDate === formDate).map((a) => normaliseName(a.fullName)),
  );
  return [...new Set(signers)].filter((s) => !present.has(normaliseName(s)));
}

/** The crew was on site within the last `cadenceDays` days (up to `today`) and no form was submitted in that window. */
export function isOverdue(args: {
  cadenceDays: number;
  today: string;
  lastSubmittedDate: string | null;
  attendance: readonly AttendanceRow[];
}): boolean {
  const from = addDays(args.today, -(args.cadenceDays - 1));
  const onSite = args.attendance.some((a) => a.localDate >= from && a.localDate <= args.today);
  if (!onSite) return false;
  return args.lastSubmittedDate === null || args.lastSubmittedDate < from;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
