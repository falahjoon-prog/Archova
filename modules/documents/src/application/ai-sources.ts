// What Nova may index and who may retrieve it (ai/03 §3 and §5). `documents` owns folder privacy and drawing
// visibility, so it names the access scope of each revision and the scopes a user holds; `ai` stores and filters
// on them without knowing the rules (no cross-module SQL, backend 08 §1).
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { TenantScope } from '@archova/kernel';
import { documentRevisions, documentsTable, drawingRevisions } from '../infra/tables';
import type { DocumentsContext } from './context';
import type { createFolderService } from './folders';

/** One revision of a document or drawing sheet, as Nova indexes it. */
export interface AiSourceRevision {
  sourceType: 'document' | 'drawing';
  /** Document id, or drawing sheet id: shared by every revision of one record. */
  sourceId: string;
  revisionId: string;
  revisionLabel: string;
  title: string;
  /** Document or sheet number. */
  reference: string | null;
  fileId: string;
  /** The page of the file this revision is (drawings are one sheet of a set's PDF); null = the whole file. */
  page: number | null;
  status: 'current' | 'superseded';
  /** `drawings`, or `folder:<id>` for a document. Compared with `aiAccessScopes`. */
  accessScope: string;
}

export function createAiSourceService(
  c: DocumentsContext,
  folderService: ReturnType<typeof createFolderService>,
) {
  /** Every published revision in the project, current and superseded. Drafts in review are left out. */
  async function aiSources(scope: TenantScope, projectId: string): Promise<AiSourceRevision[]> {
    const docs = await scope.tx
      .select({
        documentId: documentsTable.id,
        folderId: documentsTable.folderId,
        title: documentsTable.title,
        docNumber: documentsTable.docNumber,
        revisionId: documentRevisions.id,
        rev: documentRevisions.rev,
        fileId: documentRevisions.fileId,
        status: documentRevisions.status,
      })
      .from(documentRevisions)
      .innerJoin(documentsTable, eq(documentsTable.id, documentRevisions.documentId))
      .where(and(eq(documentsTable.projectId, projectId), isNull(documentsTable.deletedAt)));
    const sheets = await scope.tx
      .select()
      .from(drawingRevisions)
      .where(
        and(
          eq(drawingRevisions.projectId, projectId),
          inArray(drawingRevisions.status, ['current', 'superseded']),
          isNotNull(drawingRevisions.sheetId),
        ),
      );
    return [
      ...docs.map((d): AiSourceRevision => ({
        sourceType: 'document',
        sourceId: d.documentId,
        revisionId: d.revisionId,
        revisionLabel: d.rev,
        title: d.title,
        reference: d.docNumber,
        fileId: d.fileId,
        page: null,
        status: d.status,
        accessScope: `folder:${d.folderId}`,
      })),
      ...sheets.map((r): AiSourceRevision => ({
        sourceType: 'drawing',
        sourceId: r.sheetId!,
        revisionId: r.id,
        revisionLabel: r.rev,
        title: r.title,
        reference: r.sheetNumber,
        fileId: r.fileId,
        page: r.pageIndex + 1,
        status: r.status as 'current' | 'superseded',
        accessScope: 'drawings',
      })),
    ];
  }

  /**
   * The access scopes the caller holds in this project: `drawings` with drawing read, and `folder:<id>` for every
   * folder they can open with document read. Private folders follow DOC-US9, so retrieval matches what the user
   * could open themselves (ai/04 §3).
   */
  async function aiAccessScopes(scope: TenantScope, projectId: string): Promise<string[]> {
    const out: string[] = [];
    if (await c.access.can(scope, 'documents.drawings.read', { projectId })) out.push('drawings');
    if (await c.access.can(scope, 'documents.documents.read', { projectId })) {
      for (const f of await folderService.list(scope, projectId)) out.push(`folder:${f.id}`);
    }
    return out;
  }

  return { aiSources, aiAccessScopes };
}
