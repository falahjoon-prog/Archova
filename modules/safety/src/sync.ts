import { decodeId, type IdKind } from '@archova/domain';
import { AppError, forbidden, type SyncCommand } from '@archova/kernel';
import { INCIDENT_TYPES, type IncidentType } from './domain/incident';
import type { IncidentService, PersonInput } from './application/incidents';
import type { SafetyDeps } from './application/swms';

const invalid = (path: string, message = 'Invalid') =>
  new AppError('validation_failed', message, [{ path, message }]);

function id(kind: IdKind, value: unknown, path: string): string {
  const uuid = typeof value === 'string' ? decodeId(kind, value) : null;
  if (!uuid) throw invalid(path, 'Invalid id');
  return uuid;
}

function text(v: unknown, path: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || v.length > max) throw invalid(path);
  return v.trim() === '' ? undefined : v;
}

/**
 * Commands a device may queue offline. Reporting is the only one: investigating, classifying and closing need the
 * builder's judgement and a live server, so they stay online.
 */
export function incidentSyncCommands(incidents: IncidentService, deps: SafetyDeps): SyncCommand[] {
  const reportIncident: SyncCommand = {
    name: 'safety.reportIncident',
    module: 'safety',
    async run(scope, m) {
      const incidentId = id('incident', m.entityId, 'entityId');
      const p = m.payload;
      const projectId = id('project', p.projectId, 'payload/projectId');
      if (!(await deps.access.can(scope, 'safety.incidents.report', { projectId })))
        throw forbidden();
      const title = text(p.title, 'payload/title', 200);
      if (!title) throw invalid('payload/title', 'Required');
      if (typeof p.type !== 'string' || !(INCIDENT_TYPES as readonly string[]).includes(p.type))
        throw invalid('payload/type');
      const occurredAt = typeof p.occurredAt === 'string' ? new Date(p.occurredAt) : null;
      if (!occurredAt || Number.isNaN(occurredAt.getTime())) throw invalid('payload/occurredAt');
      const location = text(p.location, 'payload/location', 200);
      const description = text(p.description, 'payload/description', 10000);
      const immediateActions = text(p.immediateActions, 'payload/immediateActions', 10000);
      const people: PersonInput[] = [];
      if (p.people !== undefined) {
        if (!Array.isArray(p.people) || p.people.length > 50) throw invalid('payload/people');
        p.people.forEach((raw, i) => {
          const r = (raw ?? {}) as Record<string, unknown>;
          const name = text(r.personName, `payload/people/${i}/personName`, 200);
          if (!name) throw invalid(`payload/people/${i}/personName`, 'Required');
          if (r.role !== 'injured' && r.role !== 'witness' && r.role !== 'involved')
            throw invalid(`payload/people/${i}/role`);
          people.push({ personName: name, role: r.role });
        });
      }
      const d = await incidents.create(scope, projectId, {
        id: incidentId,
        title,
        type: p.type as IncidentType,
        occurredAt,
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        ...(immediateActions ? { immediateActions } : {}),
        ...(people.length ? { people } : {}),
      });
      return { version: d.incident.version };
    },
    // A report has no earlier copy to conflict with.
    async current() {
      return null;
    },
  };
  return [reportIncident];
}
