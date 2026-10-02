// Public interface of @archova/mod-documents.
export { createDocumentsModule, type DocumentsApi, type DocumentsModule } from './module';
export { DOCUMENTS_PERMISSIONS } from './permissions';
export { compareRevisions } from './domain/revisions';
export type { AiSourceRevision } from './application/ai-sources';
