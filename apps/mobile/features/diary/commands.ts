// Offline commands for the site diary (product 05, mobile 02 §2.4). One diary per project per day, in the
// project's time zone (DIA-AC1). Each labour, plant, delivery and delay line is its own record, so two people
// filling the same day merge line by line and never conflict (02 §2.7). Commands name the day by project and
// date; the server finds or opens that day's entry, so two phones opening the same day offline agree.

import {
  defaultEotCandidate,
  diaryChangeProblem,
  isDiaryHours,
  isHeadcount,
  type DelayType,
  type DiaryStatus,
  type PlantStatus,
} from '@archova/domain';
import { encodeId, uuidv7, type IdKind } from '@archova/domain';
import type { Capture } from '@archova/contracts';
import { isLocalDate, localDateOf, type LocalDate } from '@archova/time';
import type { SqlDatabase } from '../../lib/db/sql';
import type { UploadQueue } from '../../lib/files/upload-queue';
import type { SqliteSyncStore } from '../../lib/db/sync-store';

export const DIARY_ENTRY = 'diary_entry';

export interface DiaryEntry {
  id: string;
  projectId: string;
  date: LocalDate;
  status: DiaryStatus;
  notesText: string;
  weather: unknown;
  submittedAt: string | null;
  /** Photos of the day already on the server (public ids). */
  fileIds?: string[];
  /** Photos taken on this phone that are still uploading. */
  localPhotos?: { photoId: string; thumbnailUri: string }[];
}

export interface LabourLine {
  companyId: string;
  companyName: string;
  trade: string | null;
  headcount: number;
  hours: number;
  notes: string | null;
}
export interface PlantLine {
  description: string;
  companyId: string | null;
  quantity: number;
  hours: number;
  status: PlantStatus;
}
export interface DeliveryLine {
  description: string;
  supplierName: string | null;
  docketNumber: string | null;
  receivedAt: string;
}
export interface DelayLine {
  type: DelayType;
  description: string;
  hours: number;
  affectedCompanyIds: string[];
  isEotCandidate: boolean;
}

interface LineKinds {
  labour: LabourLine;
  plant: PlantLine;
  delivery: DeliveryLine;
  delay: DelayLine;
}
export type LineKind = keyof LineKinds;

const ENTITY: Record<LineKind, string> = {
  labour: 'diary_labour',
  plant: 'diary_plant',
  delivery: 'diary_delivery',
  delay: 'diary_delay',
};
const COMMAND_NOUN: Record<LineKind, string> = {
  labour: 'Labour',
  plant: 'Plant',
  delivery: 'Delivery',
  delay: 'Delay',
};

export type DiaryProblem =
  | 'diary.amendment_reason_required'
  | 'diary.headcount_invalid'
  | 'diary.hours_invalid'
  | 'diary.description_required'
  | 'diary.date_invalid'
  | 'diary.photos_full';

export type DiaryResult<T> = { ok: true; value: T } | { ok: false; code: DiaryProblem };

/** Today in the project's zone, the day the diary opens on (DIA-AC1, X34). */
export function diaryToday(now: Date, projectTimeZone: string): LocalDate {
  return localDateOf(now, projectTimeZone);
}

const LINE_ID_KIND: Record<LineKind, IdKind> = {
  labour: 'diaryLabour',
  plant: 'diaryPlant',
  delivery: 'diaryDelivery',
  delay: 'diaryDelay',
};

/** A new line's id, chosen on the device in the form the server uses, so the pull confirms the same record. */
export const newLineId = (kind: LineKind) => encodeId(LINE_ID_KIND[kind], uuidv7());

/** Local key for a day the server hasn't sent yet. */
const localDayId = (projectId: string, date: LocalDate) => `day:${projectId}:${date}`;

/** The day's entry: the server's copy once pulled, else the device's own until then. */
export async function getDiaryDay(
  store: SqliteSyncStore,
  projectId: string,
  date: LocalDate,
): Promise<{ entry: DiaryEntry; version: number | null; pending: boolean }> {
  const rows = await store.listRecords<DiaryEntry>(DIARY_ENTRY, projectId, { '$.date': date });
  const server = rows.find((r) => !r.id.startsWith('day:'));
  const local = rows.find((r) => r.id.startsWith('day:'));
  const row = server ?? local;
  if (row) return { entry: row.data, version: row.version, pending: row.pending };
  return {
    entry: {
      id: localDayId(projectId, date),
      projectId,
      date,
      status: 'draft',
      notesText: '',
      weather: null,
      submittedAt: null,
    },
    version: null,
    pending: false,
  };
}

function validate<K extends LineKind>(kind: K, line: LineKinds[K]): DiaryProblem | null {
  switch (kind) {
    case 'labour': {
      const l = line as LabourLine;
      if (!isHeadcount(l.headcount)) return 'diary.headcount_invalid';
      return isDiaryHours(l.hours) ? null : 'diary.hours_invalid';
    }
    case 'plant': {
      const p = line as PlantLine;
      if (!p.description.trim()) return 'diary.description_required';
      return isDiaryHours(p.hours) ? null : 'diary.hours_invalid';
    }
    case 'delivery':
      return (line as DeliveryLine).description.trim() ? null : 'diary.description_required';
    case 'delay': {
      const d = line as DelayLine;
      if (!d.description.trim()) return 'diary.description_required';
      return isDiaryHours(d.hours) ? null : 'diary.hours_invalid';
    }
  }
  return null;
}

export interface LineInput<K extends LineKind> {
  kind: K;
  projectId: string;
  date: LocalDate;
  lineId: string;
  mutationId: string;
  line: LineKinds[K];
  /** Required once the day is submitted: the change becomes an amendment (DIA-AC8). */
  amendmentReason?: string | null;
  clientAt: string;
}

/** Add a line to a day (DIA-US2, US3, US4). */
export async function addDiaryLine<K extends LineKind>(
  store: SqliteSyncStore,
  input: LineInput<K>,
): Promise<DiaryResult<string>> {
  if (!isLocalDate(input.date)) return { ok: false, code: 'diary.date_invalid' };
  const day = await getDiaryDay(store, input.projectId, input.date);
  const problem =
    diaryChangeProblem(day.entry.status, input.amendmentReason) ?? validate(input.kind, input.line);
  if (problem) return { ok: false, code: problem };
  const data = { projectId: input.projectId, date: input.date, ...input.line };
  await store.write(
    { entityType: ENTITY[input.kind], id: input.lineId, data },
    {
      mutationId: input.mutationId,
      command: `diary.add${COMMAND_NOUN[input.kind]}`,
      projectId: input.projectId,
      baseVersion: null,
      clientAt: input.clientAt,
      payload: { ...data, amendmentReason: input.amendmentReason?.trim() || null },
      dependsOn: [],
    },
  );
  return { ok: true, value: input.lineId };
}

/** Remove a line (a mistake, or an amendment after submit). */
export async function removeDiaryLine(
  store: SqliteSyncStore,
  input: {
    kind: LineKind;
    projectId: string;
    date: LocalDate;
    lineId: string;
    mutationId: string;
    amendmentReason?: string | null;
    clientAt: string;
  },
): Promise<DiaryResult<null>> {
  const day = await getDiaryDay(store, input.projectId, input.date);
  const problem = diaryChangeProblem(day.entry.status, input.amendmentReason);
  if (problem) return { ok: false, code: problem };
  const record = await store.get(ENTITY[input.kind], input.lineId);
  await store.write(
    {
      entityType: ENTITY[input.kind],
      id: input.lineId,
      data: { ...(record?.data as object), removed: true },
    },
    {
      mutationId: input.mutationId,
      command: `diary.remove${COMMAND_NOUN[input.kind]}`,
      projectId: input.projectId,
      baseVersion: record?.version ?? null,
      clientAt: input.clientAt,
      payload: {
        projectId: input.projectId,
        date: input.date,
        amendmentReason: input.amendmentReason?.trim() || null,
      },
      dependsOn: [],
    },
  );
  return { ok: true, value: null };
}

/** Lines of one kind on a day, oldest first; removed ones are left out. */
export async function listDiaryLines<K extends LineKind>(
  store: SqliteSyncStore,
  kind: K,
  projectId: string,
  date: LocalDate,
) {
  const rows = await store.listRecords<LineKinds[K] & { removed?: boolean }>(
    ENTITY[kind],
    projectId,
    { '$.date': date },
  );
  return rows
    .filter((r) => !r.data.removed)
    .map((r) => ({ id: r.id, pending: r.pending, ...r.data }))
    .reverse();
}

/** DIA-AC3: yesterday's companies to start today's labour from, with headcount left blank. */
export async function yesterdaysCompanies(
  store: SqliteSyncStore,
  projectId: string,
  yesterday: LocalDate,
): Promise<{ companyId: string; companyName: string; trade: string | null }[]> {
  const lines = await listDiaryLines(store, 'labour', projectId, yesterday);
  const seen = new Map<string, { companyId: string; companyName: string; trade: string | null }>();
  for (const l of lines) {
    const key = `${l.companyId}|${l.trade ?? ''}`;
    if (!seen.has(key))
      seen.set(key, { companyId: l.companyId, companyName: l.companyName, trade: l.trade });
  }
  return [...seen.values()];
}

/** Totals shown live (DIA-AC3). */
export function labourTotals(lines: { headcount: number; hours: number }[]) {
  return {
    headcount: lines.reduce((n, l) => n + l.headcount, 0),
    personHours: lines.reduce((n, l) => n + l.headcount * l.hours, 0),
  };
}

export function newDelay(type: DelayType, description: string, hours: number): DelayLine {
  return {
    type,
    description,
    hours,
    affectedCompanyIds: [],
    isEotCandidate: defaultEotCandidate(type),
  };
}

/** Notes for the day; once submitted, an amendment with a reason. */
export async function setDiaryNotes(
  store: SqliteSyncStore,
  input: {
    projectId: string;
    date: LocalDate;
    notesText: string;
    mutationId: string;
    amendmentReason?: string | null;
    clientAt: string;
  },
): Promise<DiaryResult<null>> {
  const day = await getDiaryDay(store, input.projectId, input.date);
  const problem = diaryChangeProblem(day.entry.status, input.amendmentReason);
  if (problem) return { ok: false, code: problem };
  await store.write(
    {
      entityType: DIARY_ENTRY,
      id: day.entry.id,
      data: { ...day.entry, notesText: input.notesText },
    },
    {
      mutationId: input.mutationId,
      command: 'diary.setNotes',
      projectId: input.projectId,
      baseVersion: day.version,
      clientAt: input.clientAt,
      payload: {
        projectId: input.projectId,
        date: input.date,
        notesText: input.notesText,
        amendmentReason: input.amendmentReason?.trim() || null,
      },
      dependsOn: [],
    },
  );
  return { ok: true, value: null };
}

/**
 * Submit and lock the day (DIA-US8, DIA-AC7). It goes after every queued change to the day, and keeps the
 * device's submit time, so a day finished in a basement is not marked late by the time it syncs.
 */
export async function submitDiaryDay(
  store: SqliteSyncStore,
  input: { projectId: string; date: LocalDate; mutationId: string; clientAt: string },
): Promise<DiaryResult<null>> {
  const day = await getDiaryDay(store, input.projectId, input.date);
  if (day.entry.status !== 'draft') return { ok: true, value: null };
  const queued = (await store.listOutbox()).filter(
    (e) =>
      e.command.startsWith('diary.') &&
      e.projectId === input.projectId &&
      (e.status === 'pending' || e.status === 'held') &&
      (e.payload as { date?: string }).date === input.date,
  );
  await store.write(
    {
      entityType: DIARY_ENTRY,
      id: day.entry.id,
      data: { ...day.entry, status: 'submitted', submittedAt: input.clientAt },
    },
    {
      mutationId: input.mutationId,
      command: 'diary.submit',
      projectId: input.projectId,
      baseVersion: day.version,
      clientAt: input.clientAt,
      payload: { projectId: input.projectId, date: input.date },
      dependsOn: queued.map((e) => e.mutationId),
    },
  );
  return { ok: true, value: null };
}

export interface DayPhotoInput {
  projectId: string;
  date: LocalDate;
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
  /** Required once the day is submitted. */
  amendmentReason?: string | null;
  clientAt: string;
}

/** The server holds at most this many photos on a day. */
export const MAX_DAY_PHOTOS = 50;

/**
 * A photo for the day, taken with no signal. It shows on the day at once; the file uploads in the background and
 * then `diary.attachPhoto` (held until then) adds it to the day's photos. It goes after every change already queued
 * for the day, so the day exists on the server by then.
 */
export async function attachDayPhoto(
  deps: { db: SqlDatabase; store: SqliteSyncStore; uploads: UploadQueue },
  input: DayPhotoInput,
): Promise<DiaryResult<null>> {
  if (!isLocalDate(input.date)) return { ok: false, code: 'diary.date_invalid' };
  const day = await getDiaryDay(deps.store, input.projectId, input.date);
  const problem = diaryChangeProblem(day.entry.status, input.amendmentReason);
  if (problem) return { ok: false, code: problem };
  const have = (day.entry.fileIds?.length ?? 0) + (day.entry.localPhotos?.length ?? 0);
  if (have >= MAX_DAY_PHOTOS) return { ok: false, code: 'diary.photos_full' };
  const queued = (await deps.store.listOutbox()).filter(
    (e) =>
      e.command.startsWith('diary.') &&
      e.projectId === input.projectId &&
      (e.status === 'pending' || e.status === 'held') &&
      (e.payload as { date?: string }).date === input.date,
  );
  const next: DiaryEntry = {
    ...day.entry,
    fileIds: day.entry.fileIds ?? [],
    localPhotos: [
      ...(day.entry.localPhotos ?? []),
      { photoId: input.photoId, thumbnailUri: input.file.thumbnailUri },
    ],
  };
  await deps.db.withExclusiveTransactionAsync(async (tx) => {
    await deps.store.writeLocalIn(tx, {
      entityType: DIARY_ENTRY,
      id: day.entry.id,
      projectId: input.projectId,
      data: next,
    });
    await deps.store.enqueueIn(
      tx,
      {
        mutationId: input.mutationId,
        command: 'diary.attachPhoto',
        entityType: DIARY_ENTRY,
        entityId: day.entry.id,
        projectId: input.projectId,
        baseVersion: null,
        clientAt: input.clientAt,
        dependsOn: queued.map((e) => e.mutationId),
        payload: {
          projectId: input.projectId,
          date: input.date,
          amendmentReason: input.amendmentReason?.trim() || null,
        },
      },
      { held: true },
    );
    await deps.uploads.addIn(tx, {
      id: input.photoId,
      projectId: input.projectId,
      module: 'diary',
      localUri: input.file.localUri,
      filename: input.file.filename,
      mime: input.file.mime,
      sizeBytes: input.file.sizeBytes,
      sha256: input.file.sha256,
      capture: input.capture,
      releases: input.mutationId,
    });
  });
  return { ok: true, value: null };
}
