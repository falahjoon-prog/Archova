import { encodeId } from '@archova/domain';
import { defineModule, type KernelServices, type SyncSource } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { Entitlements, MessageSender } from '@archova/kernel';
import type { FilesModule } from '@archova/mod-files';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import { createAiSourceService } from './application/ai-sources';
import { createContext } from './application/context';
import { createDocumentService } from './application/documents';
import { createDrawingService } from './application/drawings';
import { createGeometryService } from './application/geometry';
import { createFolderService } from './application/folders';
import { createMarkupService } from './application/markups';
import { createTileService } from './application/tiles';
import { createTransmittalService } from './application/transmittals';
import { createTransmittalLinkService } from './application/transmittal-links';
import { documentsRoutes } from './api/routes';
import { toDocumentDto, toFolderDto } from './api/mappers';
import {
  createDrawingsSyncSource,
  createMarkupCommand,
  deleteMarkupCommand,
  updateMarkupCommand,
} from './api/drawings-sync';
import { DOCUMENTS_PERMISSIONS } from './permissions';

export function createDocumentsModule(
  services: KernelServices,
  deps: {
    access: AccessService;
    platform: Pick<PlatformApi, 'getProject' | 'getOrg' | 'resolveTenantAccess'>;
    files: Pick<FilesModule['api'], 'getFile' | 'signTiles' | 'downloadUrl'>;
    identity: Pick<IdentityApi, 'findUserByEmail' | 'getUser'>;
    /** Transmittal emails for recipients without an account (X45). */
    links: {
      messages: MessageSender;
      entitlements: (orgId: string) => Promise<Entitlements>;
      /** The public web origin the link points at, e.g. `https://app.archova.com.au`. */
      baseUrl: string;
    };
  },
) {
  const c = createContext(deps);
  const folders = createFolderService(c);
  const documents = createDocumentService(c, folders);
  const drawings = createDrawingService(c);
  const markups = createMarkupService(c, drawings);
  const geometry = createGeometryService(drawings);
  const tiles = createTileService(drawings, { signTiles: deps.files.signTiles });
  const transmittals = createTransmittalService(c, documents, drawings);
  const transmittalLinks = createTransmittalLinkService({
    database: services.database,
    transmittals,
    c,
    platform: deps.platform,
    files: deps.files,
    entitlements: deps.links.entitlements,
    redis: services.redis,
    logger: services.logger,
  });
  const aiSources = createAiSourceService(c, folders);
  const syncSource: SyncSource = {
    module: 'documents',
    permission: 'documents.documents.read',
    publicId: (entityType, id) => encodeId(entityType === 'folder' ? 'folder' : 'document', id),
    async load(scope, { projectId, entityType, ids }) {
      const out = new Map<string, { version: number; data: Record<string, unknown> }>();
      if (!projectId) return out;
      if (entityType === 'folder') {
        for (const f of await folders.visibleAmong(scope, projectId, ids))
          out.set(f.id, {
            version: f.version,
            data: toFolderDto(f) as unknown as Record<string, unknown>,
          });
      } else if (entityType === 'document') {
        for (const d of await documents.visibleAmong(scope, projectId, ids))
          out.set(d.id, {
            version: d.version,
            data: toDocumentDto(d) as unknown as Record<string, unknown>,
          });
      }
      return out;
    },
  };
  const drawingsSyncSource = createDrawingsSyncSource(drawings, markups);
  return {
    definition: defineModule({ name: 'documents', permissions: DOCUMENTS_PERMISSIONS }),
    routes: documentsRoutes({
      database: services.database,
      identity: deps.identity,
      folders,
      documents,
      drawings,
      markups,
      geometry,
      tiles,
      transmittals,
      links: transmittalLinks,
      platform: deps.platform,
      messages: deps.links.messages,
      baseUrl: deps.links.baseUrl,
      logger: services.logger,
    }),
    api: {
      /** What the mobile pull reads (modules/sync): folders and documents. */
      syncSource,
      /** The drawing register and revisions the mobile pull reads (modules/sync). */
      drawingsSyncSource,
      /** What a device may queue offline and push (modules/sync). */
      syncCommands: [
        createMarkupCommand(drawings, markups),
        updateMarkupCommand(markups),
        deleteMarkupCommand(markups),
      ],
      /** For RFIs and defects pinned to drawings: the revision and its sheet, or not_found. */
      getDrawingRevision: drawings.getRevision,
      /** For inductions linking a SWMS: the document's title, or not_found. */
      getDocumentRef: documents.ref,
      /** For inductions: a SWMS document's current file, for a worker the induction itself authorises. */
      getDocumentFileAuthorised: documents.currentFileAuthorised,
      /** For Nova revision compare (F21): the revision this one superseded on its sheet, or null. */
      getPreviousDrawingRevision: drawings.getPreviousRevision,
      /** For Nova RFI drafts (F3): a markup the caller may see on a revision, or markup.not_found. */
      getMarkup: markups.getOwn,
      /** For the files worker: record the vector geometry and scale it read off a sheet (X30). */
      recordSheetGeometry: geometry.recordExtracted,
      /** For the files worker: record a finished tile pyramid for a sheet (backend 06 §4). */
      recordDrawingTiles: tiles.recordTiles,
      /** For Nova (ai/03 §3): every published document and drawing revision, with its access scope. */
      aiSources: aiSources.aiSources,
      /** For Nova retrieval (ai/04 §3): the access scopes the caller holds in a project. */
      aiAccessScopes: aiSources.aiAccessScopes,
    },
  };
}

export type DocumentsModule = ReturnType<typeof createDocumentsModule>;
export type DocumentsApi = DocumentsModule['api'];
