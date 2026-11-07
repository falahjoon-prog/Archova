// Offline commands for defects (mobile 02 §2.4, product 06). Each user action writes the optimistic change and
// its command in one transaction; the shared lifecycle from @archova/domain decides what is allowed, the same
// rules the API applies.

import {
  defectTransition,
  hasDefectLocation,
  uuidv7,
  type DefectAction,
  type DefectActor,
  type DefectPriority,
  type DefectStage,
  type DefectStatus,
} from '@archova/domain';
import type { SqliteSyncStore } from '../../lib/db/sync-store';

export const DEFECT_ENTITY = 'defect';

export interface LocalDefect {
  id: string;
  projectId: string;
  /** Issued by the server on first sync (DEF-AC2); null until then. */
  number: number | null;
  title: string;
  description: string;
  status: DefectStatus;
  priority: DefectPriority;
  stage: DefectStage;
  trade: string | null;
  assigneeCompanyId: string | null;
  dueDate: string | null;
  locationId: string | null;
  sheetId: string | null;
  drawingRevisionId: string | null;
  pinX: number | null;
  pinY: number | null;
  /** Device time the defect was raised; the record time once accepted (AC21). */
  raisedAt: string;
  /** When the status last changed on this device; "after" photos taken since then are the fix evidence. */
  statusChangedAt: string;
}

export type CommandError =
  | 'defect.title_required'
  | 'defect.location_required'
  | 'defect.invalid_transition'
  | 'defect.not_allowed'
  | 'defect.reason_required'
  | 'defect.photo_required';

export type CommandResult<T> = { ok: true; value: T } | { ok: false; code: CommandError };

export interface NewDefectInput {
  defectId: string;
  mutationId: string;
  /** Id of the follow-up `defects.issue` queued for an assigned defect; made if not given. */
  issueMutationId?: string;
  projectId: string;
  title: string;
  description?: string;
  priority?: DefectPriority;
  stage?: DefectStage;
  trade?: string | null;
  assigneeCompanyId?: string | null;
  dueDate?: string | null;
  locationId?: string | null;
  sheetId?: string | null;
  drawingRevisionId?: string | null;
  pinX?: number | null;
  pinY?: number | null;
  clientAt: string;
}

/** DEF-US1: raise a defect. Assigned defects open straight away; unassigned ones stay drafts. */
export async function createDefect(
  store: SqliteSyncStore,
  input: NewDefectInput,
): Promise<CommandResult<{ defect: LocalDefect; mutationId: string }>> {
  const title = input.title.trim();
  if (!title) return { ok: false, code: 'defect.title_required' };
  const defect: LocalDefect = {
    id: input.defectId,
    projectId: input.projectId,
    number: null,
    title,
    description: input.description?.trim() ?? '',
    status: input.assigneeCompanyId ? 'open' : 'draft',
    priority: input.priority ?? 'medium',
    stage: input.stage ?? 'pre_pc',
    trade: input.trade ?? null,
    assigneeCompanyId: input.assigneeCompanyId ?? null,
    dueDate: input.dueDate ?? null,
    locationId: input.locationId ?? null,
    sheetId: input.sheetId ?? null,
    drawingRevisionId: input.drawingRevisionId ?? null,
    pinX: input.pinX ?? null,
    pinY: input.pinY ?? null,
    raisedAt: input.clientAt,
    statusChangedAt: input.clientAt,
  };
  if (!hasDefectLocation(defect)) return { ok: false, code: 'defect.location_required' };
  const {
    id: _id,
    number: _number,
    raisedAt: _raisedAt,
    statusChangedAt: _changed,
    ...payload
  } = defect;
  await store.write(
    { entityType: DEFECT_ENTITY, id: defect.id, data: defect },
    {
      mutationId: input.mutationId,
      command: 'defects.create',
      projectId: defect.projectId,
      baseVersion: null,
      clientAt: input.clientAt,
      payload,
      dependsOn: [],
    },
  );
  // The server starts every defect as a draft, as on the web, so an assigned one is issued in a second command
  // that follows the first. A new defect is at version 1.
  if (defect.assigneeCompanyId) {
    await store.write(
      { entityType: DEFECT_ENTITY, id: defect.id, data: defect },
      {
        mutationId: input.issueMutationId ?? uuidv7(),
        command: 'defects.issue',
        projectId: defect.projectId,
        baseVersion: 1,
        clientAt: input.clientAt,
        payload: { projectId: defect.projectId, note: null, photoIds: [] },
        dependsOn: [input.mutationId],
      },
    );
  }
  return { ok: true, value: { defect, mutationId: input.mutationId } };
}

export interface TransitionInput {
  defect: LocalDefect;
  version: number | null;
  action: DefectAction;
  actor: DefectActor;
  mutationId: string;
  reason?: string | null;
  /** Photos taken for this step, and the commands that create them (sent first). */
  photos?: { photoId: string; mutationId: string }[];
  assigneeCompanyId?: string | null;
  requirePhotoForReady?: boolean;
  clientAt: string;
}

/** DEF-US5, US6: move a defect through its lifecycle, with the reason and evidence photos. */
export async function transitionDefect(
  store: SqliteSyncStore,
  input: TransitionInput,
): Promise<CommandResult<LocalDefect>> {
  const photos = input.photos ?? [];
  const check = defectTransition({
    status: input.defect.status,
    action: input.action,
    actor: input.actor,
    reason: input.reason ?? null,
    photoCount: photos.length,
    ...(input.requirePhotoForReady === undefined
      ? {}
      : { requirePhotoForReady: input.requirePhotoForReady }),
  });
  if (!check.ok) return check;
  const assigneeCompanyId =
    input.action === 'reassign' || input.action === 'issue'
      ? (input.assigneeCompanyId ?? input.defect.assigneeCompanyId)
      : input.defect.assigneeCompanyId;
  const next: LocalDefect = {
    ...input.defect,
    status: check.to,
    assigneeCompanyId,
    statusChangedAt: input.clientAt,
  };
  await store.write(
    { entityType: DEFECT_ENTITY, id: next.id, data: next },
    {
      mutationId: input.mutationId,
      command: `defects.${input.action}`,
      projectId: next.projectId,
      baseVersion: input.version,
      clientAt: input.clientAt,
      payload: {
        projectId: next.projectId,
        note: input.reason?.trim() || null,
        photoIds: photos.map((p) => p.photoId),
        ...(assigneeCompanyId !== input.defect.assigneeCompanyId ? { assigneeCompanyId } : {}),
      },
      dependsOn: photos.map((p) => p.mutationId),
    },
  );
  return { ok: true, value: next };
}

export async function listDefects(
  store: SqliteSyncStore,
  projectId: string,
  filter: { assigneeCompanyId?: string } = {},
) {
  const where: Record<string, string> = filter.assigneeCompanyId
    ? { '$.assigneeCompanyId': filter.assigneeCompanyId }
    : {};
  const rows = await store.listRecords<LocalDefect>(DEFECT_ENTITY, projectId, where);
  return rows.map((r) => ({ ...r.data, version: r.version, pending: r.pending }));
}

export type DefectListItem = Awaited<ReturnType<typeof listDefects>>[number];

/** The unsent `defects.create` for a defect raised offline, so its photos are sent after it. */
export async function pendingCreateMutation(
  store: SqliteSyncStore,
  defectId: string,
): Promise<string[]> {
  const outbox = await store.listOutbox();
  return outbox
    .filter(
      (e) =>
        e.entityId === defectId &&
        e.command === 'defects.create' &&
        (e.status === 'pending' || e.status === 'held'),
    )
    .map((e) => e.mutationId);
}

/** Photos of a defect, newest first; `after` photos since the last status change are the fix evidence. */
export async function defectPhotos(store: SqliteSyncStore, defect: LocalDefect) {
  const rows = await store.listRecords<{
    purpose: 'before' | 'after' | null;
    mutationId?: string;
    thumbnailUri?: string;
    capture?: { takenAt?: string };
  }>('photo', defect.projectId, { '$.defectId': defect.id });
  // The photo's own queued command, while it is still unsent, so a step that needs the photo can follow it.
  const unsent = new Set((await store.listOutbox()).map((e) => e.mutationId));
  return rows.map((r) => {
    const takenAt = r.data.capture?.takenAt ?? null;
    return {
      photoId: r.id,
      mutationId: r.data.mutationId && unsent.has(r.data.mutationId) ? r.data.mutationId : null,
      thumbnailUri: r.data.thumbnailUri ?? null,
      purpose: r.data.purpose,
      takenAt,
      isNewEvidence:
        r.data.purpose === 'after' && takenAt !== null && takenAt >= defect.statusChangedAt,
    };
  });
}
