import { defineModule, type KernelServices } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import { createAiSourceService } from './application/ai-sources';
import { createContext } from './application/context';
import { createDocumentService } from './application/documents';
import { createDrawingService } from './application/drawings';
import { createFolderService } from './application/folders';
import { createMarkupService } from './application/markups';
import { createTransmittalService } from './application/transmittals';
import { documentsRoutes } from './api/routes';
import { DOCUMENTS_PERMISSIONS } from './permissions';

export function createDocumentsModule(
  services: KernelServices,
  deps: {
    access: AccessService;
    platform: Pick<PlatformApi, 'getProject'>;
    files: Pick<FilesModule['api'], 'getFile'>;
    identity: Pick<IdentityApi, 'findUserByEmail'>;
  },
) {
  const c = createContext(deps);
  const folders = createFolderService(c);
  const documents = createDocumentService(c, folders);
  const drawings = createDrawingService(c);
  const markups = createMarkupService(c, drawings);
  const transmittals = createTransmittalService(c, documents, drawings);
  const aiSources = createAiSourceService(c, folders);
  return {
    definition: defineModule({ name: 'documents', permissions: DOCUMENTS_PERMISSIONS }),
    routes: documentsRoutes({
      database: services.database,
      identity: deps.identity,
      folders,
      documents,
      drawings,
      markups,
      transmittals,
    }),
    api: {
      /** For RFIs and defects pinned to drawings: the revision and its sheet, or not_found. */
      getDrawingRevision: drawings.getRevision,
      /** For inductions linking a SWMS: the document's title, or not_found. */
      getDocumentRef: documents.ref,
      /** For Nova revision compare (F21): the revision this one superseded on its sheet, or null. */
      getPreviousDrawingRevision: drawings.getPreviousRevision,
      /** For Nova (ai/03 §3): every published document and drawing revision, with its access scope. */
      aiSources: aiSources.aiSources,
      /** For Nova retrieval (ai/04 §3): the access scopes the caller holds in a project. */
      aiAccessScopes: aiSources.aiAccessScopes,
    },
  };
}

export type DocumentsModule = ReturnType<typeof createDocumentsModule>;
export type DocumentsApi = DocumentsModule['api'];
