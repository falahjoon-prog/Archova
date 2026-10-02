import { AppError, defineRoutes } from '@archova/kernel';

// Contract stubs so the API starts with the sync operations registered (pipeline registerOperations).
// Ben replaces them with the change-feed pull and command dispatch (backend 04 §4).
export function syncRoutes() {
  return defineRoutes({
    syncPull: async () => {
      throw new AppError('not_implemented', 'Mobile sync pull is not available yet.');
    },
    syncPush: async () => {
      throw new AppError('not_implemented', 'Mobile sync push is not available yet.');
    },
  });
}
