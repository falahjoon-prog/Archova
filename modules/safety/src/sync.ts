import { decodeId, encodeId, type IdKind } from '@archova/domain';
import { AppError, forbidden, type SyncCommand, type SyncSource } from '@archova/kernel';
import { INCIDENT_TYPES, type IncidentType } from './domain/incident';
import type { IncidentService, PersonInput } from './application/incidents';
import type { SafetyDeps } from './application/swms';
import { toIncidentSyncDto } from './api/mappers';

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
 * What the phone records about an injury: a few short text answers. Anything else is refused, so the phone cannot
 * store free-form blobs in health information.
 */
const INJURY_KEYS = ['nature', 'bodyPart', 'treatment'] as const;

function injury(v: unknown, path: string): Record<string, unknown> | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw invalid(path);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (!(INJURY_KEYS as readonly string[]).includes(k)) throw invalid(`${path}/${k}`);
    const t = text(val, `${path}/${k}`, 500);
    if (t) out[k] = t;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** What the phone's pull reads for incidents (modules/sync): the caller's own reports, or all for staff. */
export function incidentSyncSource(incidents: IncidentService): SyncSource {
  return {
    module: 'safety',
    permission: 'safety.incidents.read',
    publicId: (_type, uuid) => encodeId('incident', uuid),
    async load(scope, { projectId, entityType, ids }) {
      const out = new Map<string, { version: number; data: Record<string, unknown> }>();
      // The same module also carries SWMS changes, which stay online-only.
      if (!projectId || entityType !== 'incident') return out;
      const { rows, people, photos } = await incidents.visibleAmong(scope, projectId, ids);
      for (const r of rows)
        out.set(r.id, {
          version: r.version,
          data: toIncidentSyncDto(r, people.get(r.id) ?? [], photos.get(r.id) ?? 0),
        });
      return out;
    },
  };
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
          const inj = r.role === 'injured' ? injury(r.injury, `payload/people/${i}/injury`) : null;
          people.push({ personName: name, role: r.role, ...(inj ? { injury: inj } : {}) });
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
  /**
   * `safety.attachIncidentPhoto`: a photo taken at the scene, sent once its file has uploaded. It follows the
   * `reportIncident` that created the incident, so the incident exists by the time it runs.
   */
  const attachIncidentPhoto: SyncCommand = {
    name: 'safety.attachIncidentPhoto',
    module: 'safety',
    async run(scope, m) {
      const incidentId = id('incident', m.entityId, 'entityId');
      const fileId = id('file', m.payload.fileId, 'payload/fileId');
      const projectId = await incidents.projectOf(scope, incidentId);
      if (!projectId) throw new AppError('incident.not_found');
      const row = await incidents.attachPhoto(scope, projectId, incidentId, fileId);
      return { version: row.version };
    },
    // Adding a photo never conflicts with anything.
    async current() {
      return null;
    },
  };
  return [reportIncident, attachIncidentPhoto];
}
