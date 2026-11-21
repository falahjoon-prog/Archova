// A pre-task plan being filled in on the phone: what the form holds, the starting point taken from the last plan, and
// what has to be true before the plan can be closed. Pure, so it works the same with or without a signal.
import { addDays } from '@archova/time';
import type { PretaskHazardInput, PretaskSubmitPayload } from '../../lib/actions/pretask-send';
import type { PretaskLast } from '../../lib/actions/pretask-cache';

export type RiskLevel = PretaskHazardInput['riskBefore'];
export const RISK_LEVELS: readonly RiskLevel[] = ['low', 'medium', 'high', 'extreme'];
export const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  extreme: 'Extreme',
};

export interface PretaskDraft {
  taskTitle: string;
  workDate: string;
  supervisorName: string;
  location: string;
  companyId?: string;
  swmsId?: string;
  hazards: PretaskHazardInput[];
  crew: PretaskSubmitPayload['crew'];
}

export const emptyHazard = (): PretaskHazardInput => ({
  hazard: '',
  riskBefore: 'medium',
  controls: '',
  riskAfter: 'low',
});

export const emptyDraft = (workDate: string, supervisorName: string): PretaskDraft => ({
  taskTitle: '',
  workDate,
  supervisorName,
  location: '',
  hazards: [],
  crew: [],
});

/**
 * Starts today's plan from the last one on the project: same task, place, hazards, controls and crew. Nobody's
 * signature comes across, because each person signs for today's work.
 */
export function draftFromLast(
  last: PretaskLast,
  workDate: string,
  supervisorName: string,
): PretaskDraft {
  return {
    taskTitle: last.taskTitle,
    workDate,
    supervisorName: last.supervisorName || supervisorName,
    location: last.location ?? '',
    ...(last.companyId ? { companyId: last.companyId } : {}),
    ...(last.swmsId ? { swmsId: last.swmsId } : {}),
    hazards: last.hazards.map((h) => ({
      hazard: h.hazard,
      riskBefore: h.riskBefore as RiskLevel,
      controls: h.controls,
      riskAfter: h.riskAfter as RiskLevel,
    })),
    crew: last.crew.map((c) => ({ ...c })),
  };
}

/** "Yesterday's plan" or "the plan from 18 Nov", for the button that starts from it. */
export function lastPlanLabel(last: PretaskLast, today: string): string {
  if (last.workDate === addDays(today, -1)) return "yesterday's plan";
  if (last.workDate === today) return "today's plan";
  const [y, m, d] = last.workDate.split('-').map(Number);
  const when = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `the plan from ${when}`;
}

export const lastFromDraft = (d: PretaskDraft): PretaskLast => ({
  workDate: d.workDate,
  taskTitle: d.taskTitle,
  supervisorName: d.supervisorName,
  ...(d.location ? { location: d.location } : {}),
  ...(d.companyId ? { companyId: d.companyId } : {}),
  ...(d.swmsId ? { swmsId: d.swmsId } : {}),
  hazards: d.hazards,
  crew: d.crew.map(({ personName, companyId, userId }) => ({
    personName,
    ...(companyId ? { companyId } : {}),
    ...(userId ? { userId } : {}),
  })),
});

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, extreme: 3 };

/** What stops the plan being saved at all. */
export function saveProblems(d: PretaskDraft): string[] {
  const out: string[] = [];
  if (!d.taskTitle.trim()) out.push('Say what the task is.');
  if (!d.supervisorName.trim()) out.push("Add the supervisor's name.");
  if (d.hazards.some((h) => !h.hazard.trim())) out.push('A hazard has no description.');
  return out;
}

/** What stops it being closed, as the server will check: a control for every hazard, no extreme risk left, all signed. */
export function closeBlockers(d: PretaskDraft): string[] {
  const out: string[] = [];
  const hazards = d.hazards.filter((h) => h.hazard.trim());
  if (hazards.length === 0) out.push('Add at least one hazard.');
  if (hazards.some((h) => !h.controls.trim())) out.push('Every hazard needs a control.');
  if (hazards.some((h) => h.riskAfter === 'extreme')) {
    out.push('A hazard is still extreme risk after its controls. Do not start the work.');
  }
  if (d.crew.length === 0) out.push('Add the people doing the task.');
  else if (d.crew.some((c) => !c.strokes)) out.push('Everyone on the crew has to sign.');
  return out;
}

/** Soft checks that do not stop saving: worth a second look before the crew starts. */
export function hazardWarnings(d: PretaskDraft): string[] {
  const out: string[] = [];
  for (const h of d.hazards) {
    if (!h.hazard.trim()) continue;
    if (RANK[h.riskAfter] > RANK[h.riskBefore]) {
      out.push(`"${h.hazard}" is rated riskier after its controls than before.`);
    } else if (RANK[h.riskAfter] >= RANK.high && RANK[h.riskAfter] < RANK.extreme) {
      out.push(`"${h.hazard}" is still high risk after its controls. Tell the supervisor.`);
    }
  }
  return out;
}

export function toPayload(d: PretaskDraft, close: boolean): PretaskSubmitPayload {
  return {
    taskTitle: d.taskTitle.trim(),
    workDate: d.workDate,
    supervisorName: d.supervisorName.trim(),
    ...(d.location.trim() ? { location: d.location.trim() } : {}),
    ...(d.companyId ? { companyId: d.companyId } : {}),
    ...(d.swmsId ? { swmsId: d.swmsId } : {}),
    hazards: d.hazards
      .filter((h) => h.hazard.trim())
      .map((h) => ({ ...h, hazard: h.hazard.trim(), controls: h.controls.trim() })),
    crew: d.crew.map((c) => ({ ...c, personName: c.personName.trim() })),
    close,
  };
}
