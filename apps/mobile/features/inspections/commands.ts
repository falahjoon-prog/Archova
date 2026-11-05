// Offline commands for inspections (mobile 02 §2.4, product quality). The checklist and the answers arrive with the
// inspection through the pull; answering and submitting write the optimistic change and the command together. The
// answer rules come from @archova/domain, the same ones the API applies.

import {
  failedItems,
  isEditable,
  missingRequired,
  responseProblem,
  type InspectionStatus,
  type ItemResult,
  type ItemSpec,
  type ResponseState,
} from '@archova/domain';
import { encodeId, uuidv7 } from '@archova/domain';
import type { Capture } from '@archova/contracts';
import type { SqlDatabase } from '../../lib/db/sql';
import type { UploadQueue } from '../../lib/files/upload-queue';
import type { SqliteSyncStore } from '../../lib/db/sync-store';

export const INSPECTION_ENTITY = 'inspection';
export const TEMPLATE_ENTITY = 'inspection_template';

export interface LocalItem extends ItemSpec {
  section: string;
  sort: number;
}

export interface LocalResponse {
  templateItemId: string;
  value: string | number | boolean | null;
  result: ItemResult | null;
  note: string | null;
  fileIds: string[];
  /** Photos taken on this device that the server has not stored yet; the pull replaces them with `fileIds`. */
  localPhotos?: { photoId: string; thumbnailUri: string }[];
  defectId: string | null;
  updatedAt: string;
}

/** The pulled inspection record: the API's Inspection fields with the checklist and answers alongside. */
export interface LocalInspection {
  id: string;
  projectId: string;
  numberLabel: string;
  title: string;
  location: string | null;
  status: InspectionStatus;
  completedAt: string | null;
  signedBy: { name: string; fileId: string | null; at: string } | null;
  items: LocalItem[];
  responses: LocalResponse[];
  missingRequiredItemIds: string[];
  failedItemIds: string[];
}

export type InspectionError =
  | 'inspection.not_editable'
  | 'inspection.invalid_answer'
  | 'inspection.incomplete'
  | 'inspection.signer_required'
  | 'inspection.item_not_found';

export type InspectionResult<T> =
  { ok: true; value: T } | { ok: false; code: InspectionError; message?: string };

export async function listInspections(store: SqliteSyncStore, projectId: string) {
  const rows = await store.listRecords<LocalInspection>(INSPECTION_ENTITY, projectId);
  return rows.map((r) => ({ ...r.data, id: r.id, version: r.version, pending: r.pending }));
}

export async function getInspection(store: SqliteSyncStore, id: string) {
  const row = await store.get(INSPECTION_ENTITY, id);
  if (!row) return null;
  return {
    inspection: row.data as LocalInspection,
    version: row.version,
    pending: row.pending,
  };
}

const stateOf = (responses: readonly LocalResponse[]) =>
  new Map<string, ResponseState>(
    responses.map((r) => [
      r.templateItemId,
      {
        value: r.value,
        result: r.result,
        fileIds: [...r.fileIds, ...(r.localPhotos ?? []).map((p) => p.photoId)],
      },
    ]),
  );

/** Recompute what is still unanswered and what failed after the answers change. */
function withDerived(i: LocalInspection, responses: LocalResponse[]): LocalInspection {
  const state = stateOf(responses);
  return {
    ...i,
    responses,
    missingRequiredItemIds: missingRequired(i.items, state).map((x) => x.id),
    failedItemIds: failedItems(i.items, state).map((x) => x.id),
  };
}

export interface AnswerInput {
  inspection: LocalInspection;
  /** The server version the record was last pulled at; null if it never was. */
  version: number | null;
  itemId: string;
  answer: { value?: string | number | boolean; result?: ItemResult; note?: string };
  mutationId: string;
  clientAt: string;
}

/** Save one answer. Answers never conflict by version: the server merges them item by item. */
export async function saveAnswer(
  store: SqliteSyncStore,
  input: AnswerInput,
): Promise<InspectionResult<LocalInspection>> {
  const { inspection, itemId, answer } = input;
  if (!isEditable(inspection.status)) return { ok: false, code: 'inspection.not_editable' };
  const item = inspection.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, code: 'inspection.item_not_found' };
  const existing = inspection.responses.find((r) => r.templateItemId === itemId);
  const merged = {
    value: answer.value ?? existing?.value ?? null,
    result: answer.result ?? existing?.result ?? null,
    note: answer.note ?? existing?.note ?? null,
    fileIds: [...(existing?.fileIds ?? []), ...(existing?.localPhotos ?? []).map((p) => p.photoId)],
  };
  // A note alone is allowed on an item that already has its answer; the answer itself must fit the item.
  const problem = responseProblem(item, merged);
  if (problem) return { ok: false, code: 'inspection.invalid_answer', message: problem };
  const response: LocalResponse = {
    templateItemId: itemId,
    value: item.responseType === 'pass_fail_na' ? null : merged.value,
    result: item.responseType === 'pass_fail_na' ? merged.result : null,
    note: merged.note,
    fileIds: existing?.fileIds ?? [],
    ...(existing?.localPhotos?.length ? { localPhotos: existing.localPhotos } : {}),
    defectId: existing?.defectId ?? null,
    updatedAt: input.clientAt,
  };
  const next = withDerived({ ...inspection, status: 'in_progress' }, [
    ...inspection.responses.filter((r) => r.templateItemId !== itemId),
    response,
  ]);
  await store.write(
    { entityType: INSPECTION_ENTITY, id: inspection.id, data: next },
    {
      mutationId: input.mutationId,
      command: 'quality.recordResponses',
      projectId: inspection.projectId,
      baseVersion: input.version,
      clientAt: input.clientAt,
      payload: {
        responses: [
          {
            templateItemId: itemId,
            ...(response.value !== null ? { value: response.value } : {}),
            ...(response.result ? { result: response.result } : {}),
            ...(response.note !== null ? { note: response.note } : {}),
          },
        ],
      },
      dependsOn: await waitingFor(store, inspection.id),
    },
  );
  return { ok: true, value: next };
}

export interface SubmitInput {
  inspection: LocalInspection;
  version: number | null;
  signedByName: string;
  mutationId: string;
  clientAt: string;
}

/** Sign and submit once every required item is answered. Later edits are refused, as on the server. */
export async function submitInspection(
  store: SqliteSyncStore,
  input: SubmitInput,
): Promise<InspectionResult<LocalInspection>> {
  const { inspection } = input;
  const name = input.signedByName.trim();
  if (!isEditable(inspection.status)) return { ok: false, code: 'inspection.not_editable' };
  if (inspection.missingRequiredItemIds.length > 0)
    return { ok: false, code: 'inspection.incomplete' };
  if (!name) return { ok: false, code: 'inspection.signer_required' };
  const next: LocalInspection = {
    ...inspection,
    status: 'submitted',
    completedAt: input.clientAt,
    signedBy: { name, fileId: null, at: input.clientAt },
  };
  await store.write(
    { entityType: INSPECTION_ENTITY, id: inspection.id, data: next },
    {
      mutationId: input.mutationId,
      command: 'quality.submit',
      projectId: inspection.projectId,
      baseVersion: input.version,
      clientAt: input.clientAt,
      payload: { signedByName: name },
      dependsOn: await waitingFor(store, inspection.id),
    },
  );
  return { ok: true, value: next };
}

export const statusLabel: Record<InspectionStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  submitted: 'Submitted',
  closed: 'Closed',
};

/** A published checklist as pulled: the template's fields with its items alongside. */
export interface LocalTemplate {
  id: string;
  projectId: string;
  name: string;
  type: string;
  version: number;
  published: boolean;
  items: LocalItem[];
}

/** The checklists an inspector can start from: published only, and only the latest version of each name. */
export function latestTemplates<T extends { name: string; version: number; published: boolean }>(
  templates: readonly T[],
): T[] {
  const best = new Map<string, T>();
  for (const t of templates) {
    if (!t.published) continue;
    const key = t.name.trim().toLowerCase();
    const have = best.get(key);
    if (!have || t.version > have.version) best.set(key, t);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTemplates(store: SqliteSyncStore, projectId: string) {
  const rows = await store.listRecords<LocalTemplate>(TEMPLATE_ENTITY, projectId);
  return latestTemplates(rows.map((r) => ({ ...r.data, id: r.id })));
}

export interface StartInspectionInput {
  template: LocalTemplate;
  title?: string;
  location?: string;
  mutationId: string;
  clientAt: string;
}

/**
 * Starts an inspection from a published checklist with no signal: it is on the device at once, ready to answer, and
 * `quality.startInspection` creates it on the server under the same id (the server gives the number later).
 */
export async function startInspection(
  store: SqliteSyncStore,
  input: StartInspectionInput,
): Promise<InspectionResult<LocalInspection>> {
  const { template } = input;
  if (!template.published || template.items.length === 0)
    return { ok: false, code: 'inspection.not_editable', message: 'This checklist has no items.' };
  const title = input.title?.trim() || template.name;
  const location = input.location?.trim() || null;
  const inspection: LocalInspection = withDerived(
    {
      id: encodeId('inspection', uuidv7()),
      projectId: template.projectId,
      numberLabel: 'New',
      title,
      location,
      status: 'scheduled',
      completedAt: null,
      signedBy: null,
      items: template.items,
      responses: [],
      missingRequiredItemIds: [],
      failedItemIds: [],
    },
    [],
  );
  await store.write(
    { entityType: INSPECTION_ENTITY, id: inspection.id, data: inspection },
    {
      mutationId: input.mutationId,
      command: 'quality.startInspection',
      projectId: inspection.projectId,
      baseVersion: null,
      clientAt: input.clientAt,
      payload: {
        templateId: template.id,
        title,
        ...(location ? { location } : {}),
      },
      dependsOn: [],
    },
  );
  return { ok: true, value: inspection };
}

/** Commands for this inspection still waiting to be sent, so a later answer is applied after them. */
async function waitingFor(store: SqliteSyncStore, inspectionId: string): Promise<string[]> {
  return (await store.listOutbox())
    .filter((e) => e.entityType === INSPECTION_ENTITY && e.entityId === inspectionId)
    .map((e) => e.mutationId);
}

export interface AttachPhotoInput {
  inspection: LocalInspection;
  itemId: string;
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
 * A photo for one checklist item, taken with no signal. It shows on the item at once; the file uploads in the
 * background and then `quality.attachItemPhoto` (held until then) adds it to the item's answer. An item that takes
 * another kind of answer needs that answer first, so a photo never becomes the whole answer by accident.
 */
export async function attachItemPhoto(
  deps: { db: SqlDatabase; store: SqliteSyncStore; uploads: UploadQueue },
  input: AttachPhotoInput,
): Promise<InspectionResult<LocalInspection>> {
  const { inspection } = input;
  if (!isEditable(inspection.status)) return { ok: false, code: 'inspection.not_editable' };
  const item = inspection.items.find((i) => i.id === input.itemId);
  if (!item) return { ok: false, code: 'inspection.item_not_found' };
  const existing = inspection.responses.find((r) => r.templateItemId === input.itemId);
  if (item.responseType !== 'photo' && !existing)
    return {
      ok: false,
      code: 'inspection.invalid_answer',
      message: 'Answer this item first, then add the photo.',
    };
  const response: LocalResponse = {
    templateItemId: input.itemId,
    value: existing?.value ?? null,
    result: existing?.result ?? null,
    note: existing?.note ?? null,
    fileIds: existing?.fileIds ?? [],
    localPhotos: [
      ...(existing?.localPhotos ?? []),
      { photoId: input.photoId, thumbnailUri: input.file.thumbnailUri },
    ],
    defectId: existing?.defectId ?? null,
    updatedAt: input.clientAt,
  };
  const next = withDerived({ ...inspection, status: 'in_progress' }, [
    ...inspection.responses.filter((r) => r.templateItemId !== input.itemId),
    response,
  ]);
  const earlier = await waitingFor(deps.store, inspection.id);
  await deps.db.withExclusiveTransactionAsync(async (tx) => {
    await deps.store.writeLocalIn(tx, {
      entityType: INSPECTION_ENTITY,
      id: inspection.id,
      projectId: inspection.projectId,
      data: next,
    });
    await deps.store.enqueueIn(
      tx,
      {
        mutationId: input.mutationId,
        command: 'quality.attachItemPhoto',
        entityType: INSPECTION_ENTITY,
        entityId: inspection.id,
        projectId: inspection.projectId,
        baseVersion: null,
        clientAt: input.clientAt,
        dependsOn: earlier,
        payload: { templateItemId: input.itemId },
      },
      { held: true },
    );
    await deps.uploads.addIn(tx, {
      id: input.photoId,
      projectId: inspection.projectId,
      module: 'quality',
      localUri: input.file.localUri,
      filename: input.file.filename,
      mime: input.file.mime,
      sizeBytes: input.file.sizeBytes,
      sha256: input.file.sha256,
      capture: input.capture,
      releases: input.mutationId,
    });
  });
  return { ok: true, value: next };
}
