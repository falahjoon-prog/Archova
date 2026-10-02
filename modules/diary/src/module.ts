import { defineModule, type KernelServices } from '@archova/kernel';
import { createDiaryService, type DiaryDeps } from './application/diary';
import { diaryRoutes } from './api/routes';
import { DIARY_PERMISSIONS } from './permissions';

export function createDiaryModule(services: KernelServices, deps: DiaryDeps) {
  const service = createDiaryService(deps);
  return {
    definition: defineModule({ name: 'diary', permissions: DIARY_PERMISSIONS }),
    routes: diaryRoutes(services.database, service),
    api: {},
  };
}

export type DiaryModule = ReturnType<typeof createDiaryModule>;
