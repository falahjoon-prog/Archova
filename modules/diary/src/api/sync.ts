import { decodeId, type IdKind } from '@archova/domain';
import { isLocalDate, type LocalDate } from '@archova/time';
import { AppError, type SyncCommand, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { DiaryService, LineValues } from '../application/diary';
import type { LineKind } from '../domain/diary';
import { decodeIds } from './decode';
import { LINE_ID_KIND } from './mappers';

/**
 * What a phone may queue offline for the site diary: add or remove a labour, plant, delivery or delay line, set the
 * day's notes, attach a photo to the day and submit it. Each runs the same service call as the REST endpoint, so
 * the day's lock, amendment reasons and hours rules are judged exactly as online. A command names the day by project
 * and date: the phone may not know the server's entry id, and two phones opening the same day agree on one entry.
 */
const invalid = (path: string, message = 'Invalid') =>
  new AppError('validation_failed', message, [{ path, message }]);

const LINE_COMMANDS = [
  ['labour', 'Labour'],
  ['plant', 'Plant'],
  ['delivery', 'Delivery'],
  ['delay', 'Delay'],
] as const satisfies readonly (readonly [LineKind, string])[];

function day(payload: Record<string, unknown>): { projectId: string; date: LocalDate } {
  const projectId =
    typeof payload.projectId === 'string' ? decodeId('project', payload.projectId) : null;
  if (!projectId) throw invalid('payload/projectId', 'Invalid id');
  const date = payload.date;
  if (typeof date !== 'string' || !isLocalDate(date)) throw invalid('payload/date', 'Invalid date');
  return { projectId, date };
}

function reasonOf(payload: Record<string, unknown>): string | undefined {
  const r = payload.amendmentReason;
  if (r === undefined || r === null) return undefined;
  if (typeof r !== 'string' || r.length > 2000) throw invalid('payload/amendmentReason');
  return r.trim() === '' ? undefined : r;
}

function lineId(kind: IdKind, entityId: unknown): string {
  const id = typeof entityId === 'string' ? decodeId(kind, entityId) : null;
  if (!id) throw invalid('entityId', 'Invalid id');
  return id;
}

export function diarySyncCommands(
  service: DiaryService,
  access: Pick<AccessService, 'assert'>,
): SyncCommand[] {
  const write = (scope: TenantScope, projectId: string) =>
    access.assert(scope, 'diary.entries.write', { projectId });

  // A change to a line has no earlier copy to conflict with: lines merge by line.
  const none: SyncCommand['current'] = async () => null;

  const lines = LINE_COMMANDS.flatMap(([kind, noun]): SyncCommand[] => [
    {
      name: `diary.add${noun}`,
      module: 'diary',
      async run(scope, m) {
        const id = lineId(LINE_ID_KIND[kind], m.entityId);
        const { projectId, date } = day(m.payload);
        await write(scope, projectId);
        const { projectId: _p, date: _d, amendmentReason: _r, ...rest } = m.payload;
        const row = await service.createLine(
          scope,
          projectId,
          date,
          kind,
          decodeIds(rest) as LineValues,
          reasonOf(m.payload),
          id,
        );
        return { version: row.version };
      },
      current: none,
    },
    {
      name: `diary.remove${noun}`,
      module: 'diary',
      async run(scope, m) {
        const id = lineId(LINE_ID_KIND[kind], m.entityId);
        const { projectId, date } = day(m.payload);
        await write(scope, projectId);
        await service.deleteLine(scope, projectId, date, kind, id, reasonOf(m.payload));
        return { version: (m.baseVersion ?? 0) + 1 };
      },
      current: none,
    },
  ]);

  /** The version the phone saw, or the day's current one when it had none (a day another phone opened first). */
  const expectedVersion = async (
    scope: TenantScope,
    projectId: string,
    date: LocalDate,
    base: number | null,
  ) => base ?? (await service.currentVersion(scope, projectId, date));

  const setNotes: SyncCommand = {
    name: 'diary.setNotes',
    module: 'diary',
    async run(scope, m) {
      const { projectId, date } = day(m.payload);
      const notes = m.payload.notesText;
      if (typeof notes !== 'string' || notes.length > 20_000)
        throw invalid('payload/notesText', 'Notes must be text up to 20,000 characters');
      await write(scope, projectId);
      const d = await service.saveHeader(
        scope,
        projectId,
        date,
        await expectedVersion(scope, projectId, date, m.baseVersion),
        { notes: notes.trim() === '' ? null : notes },
        reasonOf(m.payload),
      );
      return { version: d.entry.version };
    },
    current: none,
  };

  /** A photo for the day, queued held until it has uploaded; the phone fills in `fileId`. */
  const attachPhoto: SyncCommand = {
    name: 'diary.attachPhoto',
    module: 'diary',
    async run(scope, m) {
      const { projectId, date } = day(m.payload);
      const fileId = lineId('file', m.payload.fileId);
      await write(scope, projectId);
      const d = await service.detail(scope, projectId, date).catch((e: unknown) => {
        if (e instanceof AppError && e.code === 'diary.not_found') return null;
        throw e;
      });
      const have = d?.entry.fileIds ?? [];
      if (have.includes(fileId)) return { version: d!.entry.version };
      if (have.length >= 50) throw invalid('payload/fileId', 'A day holds at most 50 photos');
      const saved = await service.saveHeader(
        scope,
        projectId,
        date,
        await expectedVersion(scope, projectId, date, null),
        { fileIds: [...have, fileId] },
        reasonOf(m.payload),
      );
      return { version: saved.entry.version };
    },
    current: none,
  };

  const submit: SyncCommand = {
    name: 'diary.submit',
    module: 'diary',
    async run(scope, m) {
      const { projectId, date } = day(m.payload);
      await write(scope, projectId);
      const expected = await expectedVersion(scope, projectId, date, m.baseVersion);
      if (expected === null)
        throw new AppError('diary.not_found', `There is no diary for ${date} yet.`);
      // The phone's own submit time is kept, so a day finished in a basement is not marked late by the time it syncs.
      const d = await service.submit(scope, projectId, date, expected, m.clientAt);
      return { version: d.entry.version };
    },
    current: none,
  };

  return [...lines, setNotes, attachPhoto, submit];
}
