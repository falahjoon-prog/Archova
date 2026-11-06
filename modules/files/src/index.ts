// Public interface of @archova/mod-files.
import { defineModule, type KernelServices } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { createFilesService } from './application/files-service';
import { filesRoutes } from './api/routes';
import type { ObjectStore } from './infra/object-store';
import type { MalwareScanner } from './infra/scanner';
import type { TileUrls } from './infra/tile-urls';

export {
  createMemoryObjectStore,
  createS3ObjectStore,
  createS3WriteOnceStore,
  type WriteOnceStore,
  type ObjectStore,
  type S3Credentials,
  type S3StoreConfig,
} from './infra/object-store';
export {
  createCloudFrontTileUrls,
  createMemoryTileUrls,
  type CloudFrontTileConfig,
  type TileUrls,
} from './infra/tile-urls';
export {
  clamdVerdict,
  createClamAvScanner,
  createGuardDutyScanner,
  guardDutyVerdict,
  noScanner,
  type MalwareScanner,
  type ScanVerdict,
} from './infra/scanner';
export { hexToBase64, quarantineKey, threatKey } from './domain/rules';
export { moveThreats, type ThreatMoveResult } from './application/threats';
export { assertFileReady } from './application/files-service';

export function createFilesModule(
  services: KernelServices,
  deps: {
    access: AccessService;
    store: ObjectStore;
    scanner: MalwareScanner;
    uploadPermissions?: Readonly<Record<string, string>>;
    tiles: TileUrls;
  },
) {
  const service = createFilesService({ ...deps, logger: services.logger });
  return {
    definition: defineModule({ name: 'files' }),
    routes: filesRoutes(services.database, service),
    api: {
      getFile: service.get,
      readFileBytes: service.readBytes,
      /** For access-link flows (X45): the module checks the link, then passes `authorised`. */
      createUpload: service.createUpload,
      completeUpload: service.complete,
      downloadUrl: service.downloadUrl,
      /** Signed template and overview URL for a drawing's tile pyramid (mobile 03 §3.3). */
      signTiles: deps.tiles.sign,
    },
  };
}

export type FilesModule = ReturnType<typeof createFilesModule>;
export type FilesApi = FilesModule['api'];
