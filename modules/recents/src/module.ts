import { defineModule, type KernelServices } from '@archova/kernel';
import { recentsRoutes } from './api/routes';
import { createRecentsService } from './application/recents';

/** Recents: the records a person opened lately, for the project home. */
export function createRecentsModule(services: KernelServices) {
  const service = createRecentsService();
  return {
    definition: defineModule({ name: 'recents', permissions: [] }),
    routes: recentsRoutes(services.database, service),
  };
}

export type RecentsModule = ReturnType<typeof createRecentsModule>;
