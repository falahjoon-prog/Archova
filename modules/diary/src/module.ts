import { defineModule, type KernelServices } from '@archova/kernel';
import { createDiaryService, type DiaryDeps } from './application/diary';
import { diaryRoutes } from './api/routes';
import { DIARY_PERMISSIONS } from './permissions';

export function createDiaryModule(services: KernelServices, deps: DiaryDeps) {
  const service = createDiaryService(deps);
  return {
    definition: defineModule({ name: 'diary', permissions: DIARY_PERMISSIONS }),
    routes: diaryRoutes(services.database, service),
    api: {
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
