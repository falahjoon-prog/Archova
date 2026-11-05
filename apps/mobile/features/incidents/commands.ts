// Offline incident reporting (product safety). A worker on site logs what happened; the report is stored on the device
// and queued as `safety.reportIncident`. Classifying, investigating and closing an incident stay online with the
// builder's safety team, so the device only ever creates reports.

import type { Capture } from '@archova/contracts';
import { encodeId, uuidv7 } from '@archova/domain';
import type { SqlDatabase } from '../../lib/db/sql';
import type { SqliteSyncStore } from '../../lib/db/sync-store';
import type { UploadQueue } from '../../lib/files/upload-queue';

export const INCIDENT_ENTITY = 'incident';

export const INCIDENT_TYPES = [
  'injury',
  'near_miss',
  'property_damage',
  'environmental',
  'dangerous_occurrence',
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const incidentTypeLabel: Record<IncidentType, string> = {
  injury: 'Injury',
  near_miss: 'Near miss',
  property_damage: 'Property damage',
  environmental: 'Environmental',
  dangerous_occurrence: 'Dangerous occurrence',
};

export type PersonRole = 'injured' | 'witness' | 'involved';

/** What is asked about an injured person. Health information: short answers only, shown to people allowed to see it. */
export interface InjuryDetails {
  nature?: string;
  bodyPart?: string;
  treatment?: string;
}

export interface IncidentPerson {
  personName: string;
  role: PersonRole;
  injury?: InjuryDetails | null;
}

/**
 * What this device keeps of an incident: the report it made, then the server's copy once it has synced (the pull
 * returns the incidents this person reported, with their number and status).
 */
export interface LocalIncident {
  id: string;
  projectId: string;
  /** Given by the server; null until the report has synced. */
  number?: number | null;
  /** `INC-0042`; null until the report has synced. */
  numberLabel?: string | null;
  status?: 'reported' | 'investigating' | 'closed';
  /** Photos the server holds. */
  photoCount?: number;
  /** Photos taken on this device that are still on their way. */
  localPhotos?: { photoId: string; thumbnailUri: string }[];
  title: string;
  type: IncidentType;
  occurredAt: string;
  location: string | null;
  description: string;
  immediateActions: string | null;
  people: IncidentPerson[];
}

export interface ReportIncidentInput {
  projectId: string;
  title: string;
  type: IncidentType;
  occurredAt: string;
  location?: string;
  description?: string;
  immediateActions?: string;
  people?: IncidentPerson[];
  mutationId: string;
  clientAt: string;
}

export type ReportIncidentResult =
  | { ok: true; value: LocalIncident }
  | { ok: false; code: 'incident.title_required' | 'incident.time_invalid' | 'incident.in_future' };

function cleanInjury(i: InjuryDetails | null | undefined): InjuryDetails | null {
  if (!i) return null;
  const out: InjuryDetails = {};
  for (const k of ['nature', 'bodyPart', 'treatment'] as const) {
    const v = i[k]?.trim();
    if (v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function listIncidents(store: SqliteSyncStore, projectId: string) {
  const rows = await store.listRecords<LocalIncident>(INCIDENT_ENTITY, projectId);
  return rows
    .map((r) => ({ ...r.data, id: r.id, version: r.version, pending: r.pending }))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export async function reportIncident(
  store: SqliteSyncStore,
  input: ReportIncidentInput,
): Promise<ReportIncidentResult> {
  const title = input.title.trim();
  if (!title) return { ok: false, code: 'incident.title_required' };
  const at = new Date(input.occurredAt);
  if (Number.isNaN(at.getTime())) return { ok: false, code: 'incident.time_invalid' };
  // The server refuses a time more than a few minutes ahead; say so on the device rather than after it syncs.
  if (at.getTime() > new Date(input.clientAt).getTime() + 5 * 60_000)
    return { ok: false, code: 'incident.in_future' };
  const location = input.location?.trim() || null;
  const description = input.description?.trim() ?? '';
  const immediateActions = input.immediateActions?.trim() || null;
  const people = (input.people ?? [])
    .map((p) => {
      const injury = p.role === 'injured' ? cleanInjury(p.injury) : null;
      return {
        personName: p.personName.trim(),
        role: p.role,
        ...(injury ? { injury } : {}),
      };
    })
    .filter((p) => p.personName);
  const incident: LocalIncident = {
    id: encodeId('incident', uuidv7()),
    projectId: input.projectId,
    title,
    type: input.type,
    occurredAt: at.toISOString(),
    location,
    description,
    immediateActions,
    people,
  };
  await store.write(
    { entityType: INCIDENT_ENTITY, id: incident.id, data: incident },
    {
      mutationId: input.mutationId,
      command: 'safety.reportIncident',
      projectId: input.projectId,
      baseVersion: null,
      clientAt: input.clientAt,
      payload: {
        projectId: input.projectId,
        title,
        type: input.type,
        occurredAt: incident.occurredAt,
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        ...(immediateActions ? { immediateActions } : {}),
        ...(people.length ? { people } : {}),
      },
      dependsOn: [],
    },
  );
  return { ok: true, value: incident };
}

export interface AttachIncidentPhotoInput {
  incident: LocalIncident;
  photoId: string;
  mutationId: string;
  capture: Capture;
  file: {
    localUri: string;
    thumbnailUri: string;
    filename: string;
    mime: string;
    sizeBytes: number;
    sha256: string;
  };
  clientAt: string;
}

/**
 * A photo of the scene, taken with no signal. It shows on the incident at once; the file uploads in the background
 * and then `safety.attachIncidentPhoto` (held until then) adds it to the incident. It is sent after the report it
 * belongs to, so the incident exists on the server by then.
 */
export async function attachIncidentPhoto(
  deps: { db: SqlDatabase; store: SqliteSyncStore; uploads: UploadQueue },
  input: AttachIncidentPhotoInput,
): Promise<LocalIncident> {
  const incident = input.incident;
  const next: LocalIncident = {
    ...incident,
    localPhotos: [
      ...(incident.localPhotos ?? []),
      { photoId: input.photoId, thumbnailUri: input.file.thumbnailUri },
    ],
  };
  const earlier = (await deps.store.listOutbox())
    .filter((e) => e.entityType === INCIDENT_ENTITY && e.entityId === incident.id)
    .map((e) => e.mutationId);
  await deps.db.withExclusiveTransactionAsync(async (tx) => {
    await deps.store.writeLocalIn(tx, {
      entityType: INCIDENT_ENTITY,
      id: incident.id,
      projectId: incident.projectId,
      data: next,
    });
    await deps.store.enqueueIn(
      tx,
      {
        mutationId: input.mutationId,
        command: 'safety.attachIncidentPhoto',
        entityType: INCIDENT_ENTITY,
        entityId: incident.id,
        projectId: incident.projectId,
        baseVersion: null,
        clientAt: input.clientAt,
        dependsOn: earlier,
        payload: {},
      },
      { held: true },
    );
    await deps.uploads.addIn(tx, {
      id: input.photoId,
      projectId: incident.projectId,
      module: 'safety',
      localUri: input.file.localUri,
      filename: input.file.filename,
      mime: input.file.mime,
      sizeBytes: input.file.sizeBytes,
      sha256: input.file.sha256,
      capture: input.capture,
      releases: input.mutationId,
    });
  });
  return next;
}

/** One incident on this device, read fresh so a second photo sees the first. */
export async function getIncident(store: SqliteSyncStore, id: string) {
  const r = await store.get(INCIDENT_ENTITY, id);
  return r ? ({ ...(r.data as LocalIncident), id } as LocalIncident) : null;
}
