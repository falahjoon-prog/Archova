// Time dashboard rules: hours by employee, project, class and cost code for one week. Pure, no IO.

import { addDays, isoWeekday, type LocalDate } from '@archova/time';

export interface TimeLine {
  workerId: string;
  workerName: string;
  localDate: LocalDate;
  /** Timesheet status: draft, submitted, rejected, approved or exported. */
  status: string;
  /** Paid minutes: time worked less the unpaid break. */
  minutes: number;
  costCodeId: string | null;
}

export interface CostCodeRef {
  id: string;
  code: string;
  description: string;
  parentId: string | null;
}

/** What one project contributes; `restricted` when the caller may not read its timesheets. */
export interface ProjectTime {
  id: string;
  name: string;
  restricted: boolean;
  lines: readonly TimeLine[];
  /** Cost codes, or null when the caller may not read them (hours are then not grouped by code). */
  codes: readonly CostCodeRef[] | null;
}

/** Monday on or before the date: the dashboard always shows a Monday to Sunday week. */
export const weekStartOf = (date: LocalDate): LocalDate => addDays(date, 1 - isoWeekday(date));
export const weekEndOf = (start: LocalDate): LocalDate => addDays(start, 6);

export const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

const UNASSIGNED = 'none';
const NO_ACCESS = 'hidden';

/** The top-level cost code above this one (itself when it has no parent); the loop guard stops a bad cycle. */
export function classOf(id: string, byId: ReadonlyMap<string, CostCodeRef>): CostCodeRef | null {
  let cur = byId.get(id) ?? null;
  for (let i = 0; cur && cur.parentId && i < 20; i += 1) {
    const up = byId.get(cur.parentId);
    if (!up) break;
    cur = up;
  }
  return cur;
}

export interface TimeSummary {
  weekStart: LocalDate;
  weekEnd: LocalDate;
  totalHours: number;
  byEmployee: Array<{
    workerId: string;
    name: string;
    hours: number;
    projects: Array<{ projectId: string; name: string; hours: number }>;
  }>;
  byClass: Array<{
    /** `none` for time with no cost code, `hidden` where the cost codes can't be read. */
    key: string;
    label: string;
    hours: number;
    percent: number;
  }>;
  byProject: Array<{
    projectId: string;
    name: string;
    hours: number;
    draft: number;
    submitted: number;
    approved: number;
  }>;
  byCostCode: Array<{
    projectId: string;
    projectName: string;
    costCodeId: string | null;
    code: string;
    description: string;
    hours: number;
  }>;
  restrictedProjects: number;
}

export function summariseTime(
  weekStart: LocalDate,
  projects: readonly ProjectTime[],
  limits: { employees: number; costCodes: number } = { employees: 50, costCodes: 50 },
): TimeSummary {
  const employees = new Map<
    string,
    { name: string; minutes: number; perProject: Map<string, number> }
  >();
  const classes = new Map<string, { label: string; minutes: number }>();
  const byProject = [];
  const codeRows = new Map<
    string,
    {
      projectId: string;
      projectName: string;
      costCodeId: string | null;
      code: string;
      description: string;
      minutes: number;
    }
  >();
  let restricted = 0;
  let total = 0;

  for (const p of projects) {
    if (p.restricted) {
      restricted += 1;
      continue;
    }
    const byId = new Map((p.codes ?? []).map((c) => [c.id, c]));
    const split = { total: 0, draft: 0, submitted: 0, approved: 0 };
    for (const l of p.lines) {
      split.total += l.minutes;
      // Rejected sheets are back with the worker, so they count as draft; exported ones were approved first.
      if (l.status === 'approved' || l.status === 'exported') split.approved += l.minutes;
      else if (l.status === 'submitted') split.submitted += l.minutes;
      else split.draft += l.minutes;

      const e = employees.get(l.workerId) ?? {
        name: l.workerName,
        minutes: 0,
        perProject: new Map<string, number>(),
      };
      e.minutes += l.minutes;
      e.perProject.set(p.id, (e.perProject.get(p.id) ?? 0) + l.minutes);
      employees.set(l.workerId, e);

      const cc = l.costCodeId ? byId.get(l.costCodeId) : undefined;
      const cls =
        p.codes === null
          ? { key: NO_ACCESS, label: 'Cost codes not visible' }
          : cc
            ? classKey(cc, byId)
            : { key: UNASSIGNED, label: 'No cost code' };
      const c = classes.get(cls.key) ?? { label: cls.label, minutes: 0 };
      c.minutes += l.minutes;
      classes.set(cls.key, c);

      const rowKey = `${p.id}:${cc ? cc.id : (l.costCodeId ?? UNASSIGNED)}`;
      const r = codeRows.get(rowKey) ?? {
        projectId: p.id,
        projectName: p.name,
        costCodeId: cc ? cc.id : null,
        code: cc ? cc.code : '',
        description: cc
          ? cc.description
          : p.codes === null
            ? 'Cost codes not visible'
            : 'No cost code',
        minutes: 0,
      };
      r.minutes += l.minutes;
      codeRows.set(rowKey, r);
    }
    total += split.total;
    byProject.push({
      projectId: p.id,
      name: p.name,
      hours: hours(split.total),
      draft: hours(split.draft),
      submitted: hours(split.submitted),
      approved: hours(split.approved),
    });
  }

  const byEmployee = [...employees.entries()]
    .map(([workerId, e]) => ({
      workerId,
      name: e.name,
      hours: hours(e.minutes),
      projects: [...e.perProject.entries()]
        .map(([projectId, m]) => ({
          projectId,
          name: projects.find((x) => x.id === projectId)?.name ?? '',
          hours: hours(m),
        }))
        .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name))
    .slice(0, limits.employees);

  const byClass = [...classes.entries()]
    .map(([key, c]) => ({
      key,
      label: c.label,
      hours: hours(c.minutes),
      percent: total === 0 ? 0 : Math.round((c.minutes / total) * 1000) / 10,
    }))
    .sort((a, b) => b.hours - a.hours || a.label.localeCompare(b.label));

  const byCostCode = [...codeRows.values()]
    .map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      costCodeId: r.costCodeId,
      code: r.code,
      description: r.description,
      hours: hours(r.minutes),
    }))
    .sort((a, b) => b.hours - a.hours || a.code.localeCompare(b.code))
    .slice(0, limits.costCodes);

  return {
    weekStart,
    weekEnd: weekEndOf(weekStart),
    totalHours: hours(total),
    byEmployee,
    byClass,
    byProject: byProject.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)),
    byCostCode,
    restrictedProjects: restricted,
  };
}

function classKey(cc: CostCodeRef, byId: ReadonlyMap<string, CostCodeRef>) {
  const top = classOf(cc.id, byId) ?? cc;
  return { key: `${top.code}`, label: `${top.code} ${top.description}`.trim() };
}
