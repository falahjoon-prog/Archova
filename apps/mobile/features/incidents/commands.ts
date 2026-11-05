// Offline incident reporting (product safety). A worker on site logs what happened; the report is stored on the device
// and queued as `safety.reportIncident`. Classifying, investigating and closing an incident stay online with the
// builder's safety team, so the device only ever creates reports.

import { encodeId, uuidv7 } from '@archova/domain';
import type { SqliteSyncStore } from '../../lib/db/sync-store';

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

/** What this device keeps of a report it made. The pull does not return incidents, so this is the device's own list. */
export interface LocalIncident {
  id: string;
  projectId: string;
  title: string;
  type: IncidentType;
  occurredAt: string;
  location: string | null;
  description: string;
  immediateActions: string | null;
  people: { personName: string; role: 'injured' | 'witness' | 'involved' }[];
}

export interface ReportIncidentInput {
  projectId: string;
  title: string;
  type: IncidentType;
  occurredAt: string;
  location?: string;
  description?: string;
  immediateActions?: string;
  people?: LocalIncident['people'];
  mutationId: string;
  clientAt: string;
}

export type ReportIncidentResult =
  | { ok: true; value: LocalIncident }
  | { ok: false; code: 'incident.title_required' | 'incident.time_invalid' | 'incident.in_future' };

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
    .map((p) => ({ personName: p.personName.trim(), role: p.role }))
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
