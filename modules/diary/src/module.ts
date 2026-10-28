import { encodeId } from '@archova/domain';
import { defineModule, type KernelServices, type SyncSource } from '@archova/kernel';
import { createDiaryService, type DiaryDeps } from './application/diary';
import { diaryRoutes } from './api/routes';
import { LINE_ID_KIND, toEntryDto, toLineDto } from './api/mappers';
import type { LineKind } from './domain/diary';
import { DIARY_PERMISSIONS } from './permissions';

export function createDiaryModule(services: KernelServices, deps: DiaryDeps) {
  const service = createDiaryService(deps);
  const kindOf = (entityType: string) =>
    (Object.keys(LINE_ID_KIND) as LineKind[]).find((k) => `diary_${k}` === entityType);
  const syncSource: SyncSource = {
    module: 'diary',
    permission: 'diary.entries.read',
    publicId: (entityType, id) =>
      entityType === 'diary_entry'
        ? encodeId('diary', id)
        : encodeId(LINE_ID_KIND[kindOf(entityType)!], id),
    async load(scope, { projectId, entityType, ids }) {
      if (!projectId || (entityType !== 'diary_entry' && !kindOf(entityType))) return new Map();
      const found = await service.visibleAmong(scope, projectId, entityType, ids);
      const out = new Map<string, { version: number; data: Record<string, unknown> }>();
      for (const e of found.entries)
        out.set(e.id, {
          version: e.version,
          data: toEntryDto(e) as unknown as Record<string, unknown>,
        });
      for (const { kind, row } of found.lines)
        out.set(row.id as string, { version: row.version as number, data: toLineDto(kind, row) });
      return out;
    },
  };
  return {
    definition: defineModule({ name: 'diary', permissions: DIARY_PERMISSIONS }),
    routes: diaryRoutes(services.database, service),
    api: {
      /** What the mobile pull reads (modules/sync). */
      syncSource,
      /** Subscriber for `workforce.attendance.session_closed.v1` (its `dayTotals`), run by the worker. */
      applyAttendanceTotals: service.applyAttendanceTotals,
      /** The day's lines for the Nova diary summary; null when unreadable or absent. */
      dayForSummary: service.dayForSummary,
      /** Nova Ask: submitted and signed-off days with all their lines, to index. Called by `ai` only. */
      aiSources: service.aiSources,
      /** Nova Ask: the scopes the caller holds for the diary (builder staff who read the whole diary). */
      aiAccessScopes: service.aiAccessScopes,
    },
  };
}

export type DiaryModule = ReturnType<typeof createDiaryModule>;
export type DiaryApi = DiaryModule['api'];
