import type { TmKind } from './tm';

// Nova's rule-based checks on a T&M ticket (no model): does what the ticket says match what the site recorded?
// Everything here is advice for the reviewer; nothing blocks a ticket.

export type CheckCode =
  | 'no_diary_entry'
  | 'labour_hours_differ'
  | 'equipment_hours_differ'
  | 'labour_not_from_timesheet'
  | 'equipment_not_from_log'
  | 'signed_off_site';

export interface Finding {
  code: CheckCode;
  severity: 'warn' | 'info';
  message: string;
  /** 1-based line number the finding is about, if any. */
  line: number | null;
}

export interface CheckInput {
  workDate: string;
  lines: {
    kind: TmKind;
    description: string;
    quantity: string;
    unit: string;
    sourceType: 'timesheet_line' | 'equipment_log' | null;
    sourceId: string | null;
  }[];
  signoffs: { role: string; geofenceStatus: 'inside' | 'outside' | 'uncertain' | 'unknown' }[];
  /** The day as the workforce module saw it (timesheets and equipment logs). */
  day: {
    labour: { timesheetLineId: string; hours: string }[];
    equipment: { equipmentLogId: string; hours: string }[];
  };
  /** Whether the site diary has an entry for the work date. */
  diaryEntryExists: boolean;
}

/** A quarter of an hour: timesheets are kept to quarter hours, so smaller gaps are rounding. */
const TOLERANCE_HOURS = 0.25;
const ROLE: Record<string, string> = {
  contractor: 'contractor',
  principal_rep: 'principal’s representative',
};

export function runChecks(input: CheckInput): Finding[] {
  const out: Finding[] = [];
  if (!input.diaryEntryExists)
    out.push({
      code: 'no_diary_entry',
      severity: 'warn',
      message: `There is no site diary entry for ${input.workDate}. Either the work was not logged that day or the ticket date is wrong.`,
      line: null,
    });
  const labour = new Map(input.day.labour.map((l) => [l.timesheetLineId, Number(l.hours)]));
  const equipment = new Map(input.day.equipment.map((e) => [e.equipmentLogId, Number(e.hours)]));
  input.lines.forEach((l, i) => {
    const n = i + 1;
    const hourly = l.unit.trim().toLowerCase().startsWith('h');
    if (l.kind === 'labour' && !l.sourceId)
      out.push({
        code: 'labour_not_from_timesheet',
        severity: 'info',
        message: `Line ${n} (${l.description}) is not tied to a timesheet, so its hours cannot be checked against the worker's sign-in.`,
        line: n,
      });
    if (l.kind === 'equipment' && !l.sourceId)
      out.push({
        code: 'equipment_not_from_log',
        severity: 'info',
        message: `Line ${n} (${l.description}) is not tied to an equipment log, so its hours cannot be checked.`,
        line: n,
      });
    if (!l.sourceId || !hourly) return;
    const logged =
      l.sourceType === 'timesheet_line' ? labour.get(l.sourceId) : equipment.get(l.sourceId);
    if (logged === undefined) return;
    const said = Number(l.quantity);
    if (Math.abs(said - logged) > TOLERANCE_HOURS)
      out.push({
        code: l.sourceType === 'timesheet_line' ? 'labour_hours_differ' : 'equipment_hours_differ',
        severity: 'warn',
        message:
          l.sourceType === 'timesheet_line'
            ? `Line ${n} (${l.description}) claims ${said} hr but the worker's timesheet for the day shows ${logged} hr.`
            : `Line ${n} (${l.description}) claims ${said} hr but the equipment log for the day shows ${logged} hr.`,
        line: n,
      });
  });
  for (const s of input.signoffs)
    if (s.geofenceStatus === 'outside' || s.geofenceStatus === 'uncertain')
      out.push({
        code: 'signed_off_site',
        severity: 'warn',
        message:
          s.geofenceStatus === 'outside'
            ? `The ${ROLE[s.role] ?? s.role} sign-off was recorded outside the site fence. Treat it as remote and review in the office.`
            : `The ${ROLE[s.role] ?? s.role} sign-off position could not be confirmed as on site. Review in the office.`,
        line: null,
      });
  return out;
}
