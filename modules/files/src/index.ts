// Public interface of @archova/mod-files.
import { decodeId } from '@archova/domain';
import { AppError, defineModule, type KernelServices, type SyncCommand } from '@archova/kernel';
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
  const invalid = (path: string) =>
    new AppError('validation_failed', 'That change is not valid.', [
      { path, message: 'Expected an id' },
    ]);
  /**
   * `photos.create`: a plain site photo (not a defect's) after its file has uploaded. The phone holds it until it has
   * the file id. The file itself is the record, so this checks it and completes its capture details (idempotent).
   */
  const createPhotoCommand: SyncCommand = {
    name: 'photos.create',
    module: 'photos',
    async run(scope, m) {
      const projectId =
        typeof m.payload.projectId === 'string' ? decodeId('project', m.payload.projectId) : null;
      if (!projectId) throw invalid('payload/projectId');
      const fileId =
        typeof m.payload.fileId === 'string' ? decodeId('file', m.payload.fileId) : null;
      if (!fileId) throw invalid('payload/fileId');
      const file = await service.registerPhoto(scope, {
        projectId,
        fileId,
        capture: m.payload.capture,
      });
      return { version: file.version };
    },
    async current() {
      // The photo is the file and the phone never edits it, so there is no copy to show on a conflict.
      return null;
    },
  };
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
      /** What a device may queue offline and push (modules/sync). */
      syncCommands: [createPhotoCommand],
    },
  };
}

export type FilesModule = ReturnType<typeof createFilesModule>;
export type FilesApi = FilesModule['api'];
