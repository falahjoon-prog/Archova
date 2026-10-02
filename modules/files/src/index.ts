// Public interface of @archova/mod-files.
import { defineModule, type KernelServices } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { createFilesService } from './application/files-service';
import { filesRoutes } from './api/routes';
import type { ObjectStore } from './infra/object-store';
import type { MalwareScanner } from './infra/scanner';

export {
  createMemoryObjectStore,
  createS3ObjectStore,
  type ObjectStore,
  type S3StoreConfig,
} from './infra/object-store';
export {
  clamdVerdict,
  createClamAvScanner,
  createGuardDutyScanner,
  guardDutyVerdict,
  noScanner,
  type MalwareScanner,
  type ScanVerdict,
} from './infra/scanner';
export { hexToBase64, quarantineKey } from './domain/rules';
export { assertFileReady } from './application/files-service';

export function createFilesModule(
  services: KernelServices,
  deps: { access: AccessService; store: ObjectStore; scanner: MalwareScanner },
) {
  const service = createFilesService({ ...deps, logger: services.logger });
  return {
    definition: defineModule({ name: 'files' }),
    routes: filesRoutes(services.database, service),
    api: { getFile: service.get, readFileBytes: service.readBytes },
  };
}

export type FilesModule = ReturnType<typeof createFilesModule>;
export type FilesApi = FilesModule['api'];
