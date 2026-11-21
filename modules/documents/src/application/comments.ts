import { and, asc, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import { documentComments, documentRevisions } from '../infra/tables';
import type { DocumentsContext } from './context';
import type { DocumentService } from './documents';

type CommentRow = typeof documentComments.$inferSelect;
export interface CommentThread {
  root: CommentRow;
  replies: CommentRow[];
}

/** Structured comments: a thread per issue, replies under it, and a resolved flag on the thread. */
export function createCommentService(c: DocumentsContext, documents: DocumentService) {
  async function list(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    opts: { revisionId?: string; status?: 'open' | 'resolved' } = {},
  ): Promise<CommentThread[]> {
    await documents.detail(scope, projectId, documentId);
    const rows = await scope.tx
      .select()
      .from(documentComments)
      .where(eq(documentComments.documentId, documentId))
      .orderBy(asc(documentComments.createdAt), asc(documentComments.id));
    const roots = rows.filter(
      (r) =>
        !r.parentId &&
        (!opts.revisionId || r.revisionId === opts.revisionId) &&
        (!opts.status || r.status === opts.status),
    );
    return roots.map((root) => ({ root, replies: rows.filter((r) => r.parentId === root.id) }));
  }

  async function add(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    input: { body: string; parentId?: string; revisionId?: string; page?: number },
  ) {
    const { document } = await documents.detail(scope, projectId, documentId);
    const body = input.body.trim();
    if (!body)
      throw new AppError('validation_failed', 'Write a comment.', [
        { path: 'body', message: 'Required' },
      ]);
    let revisionId = input.revisionId ?? document.currentRevisionId ?? null;
    let page = input.page ?? null;
    if (input.parentId) {
      const [parent] = await scope.tx
        .select()
        .from(documentComments)
        .where(
          and(eq(documentComments.id, input.parentId), eq(documentComments.documentId, documentId)),
        )
        .limit(1);
      if (!parent || parent.parentId) throw new AppError('document_comment.not_found');
      revisionId = parent.revisionId;
      page = parent.page;
    } else if (input.revisionId) {
      const [rev] = await scope.tx
        .select({ id: documentRevisions.id })
        .from(documentRevisions)
        .where(
          and(
            eq(documentRevisions.id, input.revisionId),
            eq(documentRevisions.documentId, documentId),
          ),
        )
        .limit(1);
      if (!rev)
        throw new AppError('validation_failed', 'Choose a revision of this document.', [
          { path: 'revisionId', message: 'Not a revision of this document' },
        ]);
    }
    const id = uuidv7();
    await scope.tx.insert(documentComments).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      documentId,
      revisionId,
      parentId: input.parentId ?? null,
      body,
      page,
      status: 'open',
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    // A reply to a resolved thread reopens it: the issue is not settled if someone is still talking.
    if (input.parentId)
      await scope.tx
        .update(documentComments)
        .set({ status: 'open', resolvedBy: null, resolvedAt: null, resolutionNote: null })
        .where(
          and(eq(documentComments.id, input.parentId), eq(documentComments.status, 'resolved')),
        );
    return list(scope, projectId, documentId);
  }

  async function setResolved(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    commentId: string,
    input: { resolved: boolean; note?: string | null },
  ) {
    await documents.detail(scope, projectId, documentId);
    const [root] = await scope.tx
      .select()
      .from(documentComments)
      .where(
        and(
          eq(documentComments.id, commentId),
          eq(documentComments.documentId, documentId),
          isNull(documentComments.parentId),
        ),
      )
      .limit(1);
    if (!root) throw new AppError('document_comment.not_found');
    await scope.tx
      .update(documentComments)
      .set(
        input.resolved
          ? {
              status: 'resolved',
              resolvedBy: scope.ctx.userId,
              resolvedAt: new Date(),
              resolutionNote: input.note?.trim() || null,
            }
          : { status: 'open', resolvedBy: null, resolvedAt: null, resolutionNote: null },
      )
      .where(eq(documentComments.id, commentId));
    return list(scope, projectId, documentId);
  }

  return { list, add, setResolved };
}

export type CommentService = ReturnType<typeof createCommentService>;
