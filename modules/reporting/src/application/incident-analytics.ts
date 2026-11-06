import {
  decodeId,
  encodeId,
  summariseInjuries,
  type BodyPart,
  BODY_PARTS,
  type InjuryRecord,
} from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import { daysBetween, localDateOf } from '@archova/time';
import { visibleProjects, type ReportingDeps } from './sources';

export interface IncidentAnalyticsQuery {
  projectId?: string | undefined;
  companyId?: string | undefined;
  bodyPart?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

const ROW_LIMIT = 500;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Injury analytics across the projects the caller can see: body map, harm source and injury type breakdowns, the
 * injury summary rows, LTIFR and TRIFR and the days without an injury or incident. Injury detail is health
 * information, so a project where the caller lacks `view_medical` is counted in `projectsRestricted` and left out.
 */
export function createIncidentAnalyticsService(deps: ReportingDeps & { now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  async function get(scope: TenantScope, q: IncidentAnalyticsQuery) {
    const today = localDateOf(now(), 'UTC');
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -364);
    // Without an end date, include tomorrow's UTC date too: a project east of UTC is already a day ahead.
    const upper = q.to ?? addDays(today, 1);
    if (to < from)
      throw new AppError('validation_failed', 'The range must not end before it starts.', [
        { path: 'to', message: 'Must be on or after the start' },
      ]);
    if (daysBetween(from, to) > 1830)
      throw new AppError('validation_failed', 'Use a range of five years or less.', [
        { path: 'from', message: 'Range too long' },
      ]);
    const projectId = q.projectId ? decodeId('project', q.projectId) : null;
    if (q.projectId && !projectId)
      throw new AppError('validation_failed', 'Invalid id', [
        { path: 'projectId', message: 'Invalid id' },
      ]);
    const companyId = q.companyId ? decodeId('company', q.companyId) : null;
    if (q.companyId && !companyId)
      throw new AppError('validation_failed', 'Invalid id', [
        { path: 'companyId', message: 'Invalid id' },
      ]);
    if (q.bodyPart && !(BODY_PARTS as readonly string[]).includes(q.bodyPart))
      throw new AppError('validation_failed', 'Not a body part', [
        { path: 'bodyPart', message: 'Not a body part' },
      ]);

    const { projects, truncated } = await visibleProjects(deps, scope, { includeClosed: true });
    const chosen = projectId ? projects.filter((p) => p.id === projectId) : projects;
    const names = new Map(projects.map((p) => [p.id, p.name]));
    const filters = { from, to: upper, ...(companyId ? { companyId } : {}) };

    const records: InjuryRecord[] = [];
    let restricted = 0;
    let hours: number | null = 0;
    let lastInjuryOn: string | null = null;
    let lastIncidentOn: string | null = null;
    let covered = 0;
    for (const p of chosen) {
      const r = await deps.safety.injuryRows(scope, p.id, filters);
      if (r.restricted) {
        restricted += 1;
        continue;
      }
      covered += 1;
      records.push(...r.rows);
      if (r.lastInjuryOn && (!lastInjuryOn || r.lastInjuryOn > lastInjuryOn))
        lastInjuryOn = r.lastInjuryOn;
      if (r.lastIncidentOn && (!lastIncidentOn || r.lastIncidentOn > lastIncidentOn))
        lastIncidentOn = r.lastIncidentOn;
      const h = await deps.workforce.hoursWorked(scope, p.id, filters);
      hours = hours === null || h === null ? null : hours + h;
    }
    const shown = q.bodyPart ? records.filter((r) => r.bodyPart === q.bodyPart) : records;
    shown.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const summary = summariseInjuries(shown, covered === 0 ? null : hours === 0 ? null : hours);
    const since = (d: string | null) => (d ? Math.max(0, daysBetween(d, today)) : null);
    return {
      from,
      to,
      summary,
      daysWithoutInjury: since(lastInjuryOn),
      daysWithoutIncident: since(lastIncidentOn),
      projectsRestricted: restricted,
      projectsTruncated: truncated,
      rowsTruncated: shown.length > ROW_LIMIT,
      rows: shown.slice(0, ROW_LIMIT).map((r) => ({
        incidentId: encodeId('incident', r.incidentId),
        projectId: encodeId('project', r.projectId),
        projectName: names.get(r.projectId) ?? '',
        ref: r.ref,
        occurredAt: r.occurredAt,
        localDate: r.localDate,
        personName: r.personName,
        companyId: r.companyId ? encodeId('company', r.companyId) : null,
        bodyPart: r.bodyPart as BodyPart | null,
        injuryType: r.injuryType,
        harmSource: r.harmSource,
        outcome: r.outcome,
        daysLost: r.daysLost,
        notifiable: r.notifiable,
      })),
    };
  }
  return { get };
}

export type IncidentAnalyticsService = ReturnType<typeof createIncidentAnalyticsService>;
