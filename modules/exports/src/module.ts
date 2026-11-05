import { uuidv7 } from '@archova/domain';
import { defineModule, type KernelServices } from '@archova/kernel';
import type { ObjectStore } from '@archova/mod-files';
import { exportsRoutes } from './api/routes';
import { createExportsService } from './application/exports';
import { EXPORTS_PERMISSIONS } from './permissions';

/**
 * Exports: the one-click full export of an organisation's data. The API only queues the request and hands out the
 * download link; the worker builds the archive (`runExport`), because it can take minutes to hours.
 */
export function createExportsModule(services: KernelServices, deps: { store: ObjectStore }) {
  const service = createExportsService({ store: deps.store, newId: uuidv7 });
  return {
    definition: defineModule({ name: 'exports', permissions: EXPORTS_PERMISSIONS }),
    routes: exportsRoutes(services.database, service),
    api: {},
  };
}

export type ExportsModule = ReturnType<typeof createExportsModule>;
