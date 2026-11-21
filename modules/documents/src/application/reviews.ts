import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import {
  documentComments,
  documentReviews,
  documentReviewSteps,
  documentsTable,
  type ReviewMode,
  type StepRole,
  type StepStatus,
} from '../infra/tables';
import {
  initialStatuses,
  overdueDays,
  settle,
  suggestReviewers,
  type StepState,
} from '../domain/review';
import type { DocumentsContext } from './context';
import { uniqueViolation } from './errors';
import type { DocumentService } from './documents';
import type { FolderService } from './folders';

type ReviewRow = typeof documentReviews.$inferSelect;
type StepRow = typeof documentReviewSteps.$inferSelect;

export interface StartReviewInput {
  mode: ReviewMode;
  dueAt?: Date | null;
  note?: string | null;
  steps: { userId: string; role: StepRole; order: number }[];
}

export type Decision = 'approved' | 'approved_with_comments' | 'rejected';

const toState = (s: StepRow): StepState => ({
  id: s.id,
  userId: s.userId,
  role: s.role,
  order: s.stepOrder,
  status: s.status,
});

export function createReviewService(
  c: DocumentsContext,
  documents: DocumentService,
  folders: FolderService,
  now: () => Date = () => new Date(),
) {
  async function stepsOf(scope: TenantScope, reviewIds: string[]) {
    if (!reviewIds.length) return [] as StepRow[];
    return scope.tx
      .select()
      .from(documentReviewSteps)
      .where(inArray(documentReviewSteps.reviewId, reviewIds))
      .orderBy(
        asc(documentReviewSteps.stepOrder),
        asc(documentReviewSteps.createdAt),
        asc(documentReviewSteps.id),
      );
  }

  async function openComments(scope: TenantScope, documentId: string) {
    const [r] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(documentComments)
      .where(
        and(
          eq(documentComments.documentId, documentId),
          isNull(documentComments.parentId),
          eq(documentComments.status, 'open'),
        ),
      );
    return Number(r?.n ?? 0);
  }

  function view(review: ReviewRow, steps: StepRow[], currentRevisionId: string | null) {
    const pending = steps.filter((s) => s.status === 'pending');
    const waitingSince = pending.length
      ? new Date(Math.min(...pending.map((s) => (s.activatedAt ?? review.createdAt).getTime())))
      : null;
    return {
      review,
      steps,
      /** The document has a newer revision than the one this round reviewed. */
      stale:
        review.status === 'open' &&
        currentRevisionId !== null &&
        review.revisionId !== currentRevisionId,
      overdueDays:
        review.status === 'open'
          ? overdueDays({ dueAt: review.dueAt, waitingSince, now: now() })
          : 0,
    };
  }

  /** The newest round (open one first) with its matrix, or null when the document was never put out for review. */
  async function forDocument(scope: TenantScope, projectId: string, documentId: string) {
    const { document } = await documents.detail(scope, projectId, documentId);
    const rounds = await scope.tx
      .select()
      .from(documentReviews)
      .where(eq(documentReviews.documentId, documentId))
      .orderBy(desc(documentReviews.createdAt), desc(documentReviews.id));
    const steps = await stepsOf(
      scope,
      rounds.map((r) => r.id),
    );
    const views = rounds.map((r) =>
      view(
        r,
        steps.filter((s) => s.reviewId === r.id),
        document.currentRevisionId,
      ),
    );
    return {
      current: views[0] ?? null,
      history: views.slice(1),
      openComments: await openComments(scope, documentId),
    };
  }

  async function start(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    input: StartReviewInput,
  ) {
    const { document } = await documents.detail(scope, projectId, documentId);
    if (
      !document.currentRevisionId ||
      document.status === 'void' ||
      document.status === 'superseded'
    )
      throw new AppError('document_review.invalid', 'This document cannot be put out for review.');
    if (input.steps.length < 1 || input.steps.length > 20)
      throw new AppError('validation_failed', 'Add between 1 and 20 people to the matrix.', [
        { path: 'steps', message: 'Between 1 and 20 people' },
      ]);
    const ids = input.steps.map((s) => s.userId);
    if (new Set(ids).size !== ids.length)
      throw new AppError('validation_failed', 'Each person can appear in the matrix once.', [
        { path: 'steps', message: 'Duplicate person' },
      ]);
    if (input.dueAt && input.dueAt.getTime() < now().getTime() - 60_000)
      throw new AppError('validation_failed', 'Choose a due date in the future.', [
        { path: 'dueAt', message: 'In the past' },
      ]);
    await c.requireMembers(scope, projectId, ids, 'steps');
    const initial = initialStatuses(input.mode, input.steps);
    const reviewId = uuidv7();
    const at = now();
    try {
      await scope.tx.insert(documentReviews).values({
        id: reviewId,
        orgId: scope.ctx.orgId,
        projectId,
        documentId,
        revisionId: document.currentRevisionId,
        mode: input.mode,
        status: 'open',
        dueAt: input.dueAt ?? null,
        note: input.note?.trim() || null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      });
    } catch (e) {
      if (uniqueViolation(e) === 'document_reviews_one_open')
        throw new AppError(
          'document_review.already_open',
          'This document is already out for review.',
        );
      throw e;
    }
    await scope.tx.insert(documentReviewSteps).values(
      input.steps.map((s, i) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        reviewId,
        documentId,
        userId: s.userId,
        role: s.role,
        stepOrder: s.order,
        status: initial[i]!,
        activatedAt: initial[i] === 'pending' ? at : null,
      })),
    );
    await setDocumentStatus(scope, projectId, documentId, 'for_review');
    scope.events.add({
      type: 'documents.review.started.v1',
      projectId,
      entityType: 'document',
      entityId: documentId,
      entityVersion: 1,
      data: {
        documentId,
        reviewId,
        assignees: input.steps.filter((_, i) => initial[i] === 'pending').map((s) => s.userId),
      },
    });
    return forDocument(scope, projectId, documentId);
  }

  /** Moves the document's status and tells the mobile feed. */
  async function setDocumentStatus(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    status: 'draft' | 'approved' | 'for_review',
  ) {
    const [row] = await scope.tx
      .update(documentsTable)
      .set({
        status,
        updatedBy: scope.ctx.userId,
        updatedAt: now(),
        version: sql`${documentsTable.version} + 1`,
      })
      .where(eq(documentsTable.id, documentId))
      .returning({ version: documentsTable.version });
    if (row)
      await scope.recordChange({
        module: 'documents',
        entityType: 'document',
        entityId: documentId,
        op: 'upsert',
        version: row.version,
        projectId,
      });
  }

  async function openRound(scope: TenantScope, documentId: string) {
    const [review] = await scope.tx
      .select()
      .from(documentReviews)
      .where(and(eq(documentReviews.documentId, documentId), eq(documentReviews.status, 'open')))
      .for('update')
      .limit(1);
    if (!review)
      throw new AppError('document_review.not_found', 'No review is open on this document.');
    return review;
  }

  async function close(
    scope: TenantScope,
    review: ReviewRow,
    status: 'approved' | 'rejected' | 'cancelled',
  ) {
    await scope.tx
      .update(documentReviews)
      .set({
        status,
        closedAt: now(),
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
        version: review.version + 1,
      })
      .where(eq(documentReviews.id, review.id));
    await setDocumentStatus(
      scope,
      review.projectId,
      review.documentId,
      status === 'approved' ? 'approved' : 'draft',
    );
    scope.events.add({
      type: 'documents.review.closed.v1',
      projectId: review.projectId,
      entityType: 'document',
      entityId: review.documentId,
      entityVersion: review.version + 1,
      data: { documentId: review.documentId, reviewId: review.id, outcome: status },
    });
  }

  /** The assigned person decides their own step. A rejection needs a reason. */
  async function decide(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    stepId: string,
    input: { decision: Decision; note?: string | null },
  ) {
    await documents.detail(scope, projectId, documentId);
    const review = await openRound(scope, documentId);
    const steps = await stepsOf(scope, [review.id]);
    const step = steps.find((s) => s.id === stepId);
    if (!step) throw new AppError('document_review.not_found', 'That review step does not exist.');
    if (step.userId !== scope.ctx.userId)
      throw new AppError(
        'access.denied',
        'Only the person this step is assigned to can decide it.',
      );
    if (step.status !== 'pending')
      throw new AppError(
        'document_review.step_not_pending',
        'This step is not waiting on you yet.',
      );
    const note = input.note?.trim() || null;
    if ((input.decision === 'rejected' || input.decision === 'approved_with_comments') && !note)
      throw new AppError('validation_failed', 'Say why.', [{ path: 'note', message: 'Required' }]);
    const at = now();
    await scope.tx
      .update(documentReviewSteps)
      .set({
        status: input.decision,
        decidedAt: at,
        decisionNote: note,
        updatedAt: at,
        version: step.version + 1,
      })
      .where(eq(documentReviewSteps.id, stepId));
    const after = steps.map((s) =>
      s.id === stepId ? { ...s, status: input.decision as StepStatus } : s,
    );
    const result = settle(review.mode, after.map(toState));
    for (const s of after) {
      const next = result.statuses.get(s.id)!;
      if (next !== (s.id === stepId ? input.decision : s.status))
        await scope.tx
          .update(documentReviewSteps)
          .set({
            status: next,
            updatedAt: at,
            version: s.version + 1,
            ...(next === 'pending' ? { activatedAt: at } : {}),
          })
          .where(eq(documentReviewSteps.id, s.id));
    }
    scope.events.add({
      type: 'documents.review.step_decided.v1',
      projectId,
      entityType: 'document',
      entityId: documentId,
      entityVersion: review.version,
      data: { documentId, reviewId: review.id, stepId, decision: input.decision },
    });
    if (result.outcome !== 'open') await close(scope, review, result.outcome);
    return forDocument(scope, projectId, documentId);
  }

  async function cancel(scope: TenantScope, projectId: string, documentId: string) {
    await documents.detail(scope, projectId, documentId);
    const review = await openRound(scope, documentId);
    await scope.tx
      .update(documentReviewSteps)
      .set({ status: 'skipped', updatedAt: now() })
      .where(
        and(
          eq(documentReviewSteps.reviewId, review.id),
          inArray(documentReviewSteps.status, ['pending', 'waiting']),
        ),
      );
    await close(scope, review, 'cancelled');
    return forDocument(scope, projectId, documentId);
  }

  /** Hands a step that has not been decided to someone else (leave, wrong person). */
  async function reassign(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    stepId: string,
    userId: string,
  ) {
    await documents.detail(scope, projectId, documentId);
    const review = await openRound(scope, documentId);
    const steps = await stepsOf(scope, [review.id]);
    const step = steps.find((s) => s.id === stepId);
    if (!step) throw new AppError('document_review.not_found', 'That review step does not exist.');
    if (step.status !== 'pending' && step.status !== 'waiting')
      throw new AppError('document_review.step_not_pending', 'That step has already been decided.');
    if (steps.some((s) => s.userId === userId))
      throw new AppError('validation_failed', 'That person is already in the matrix.', [
        { path: 'userId', message: 'Already in the matrix' },
      ]);
    await c.requireMembers(scope, projectId, [userId], 'userId');
    await scope.tx
      .update(documentReviewSteps)
      .set({
        userId,
        updatedAt: now(),
        version: step.version + 1,
        ...(step.status === 'pending' ? { activatedAt: now() } : {}),
      })
      .where(eq(documentReviewSteps.id, stepId));
    scope.events.add({
      type: 'documents.review.step_assigned.v1',
      projectId,
      entityType: 'document',
      entityId: documentId,
      entityVersion: review.version,
      data: {
        documentId,
        reviewId: review.id,
        stepId,
        assignees: step.status === 'pending' ? [userId] : [],
      },
    });
    return forDocument(scope, projectId, documentId);
  }

  /**
   * Every open review in the project the caller can see, with who it is waiting on and how late it is.
   * `overdueOnly` is Nova's "stuck in review" list.
   */
  async function openReviews(
    scope: TenantScope,
    projectId: string,
    opts: { overdueOnly?: boolean } = {},
  ) {
    await c.requireProject(scope, projectId);
    const hidden = await folders.hiddenIds(scope, projectId);
    const rows = await scope.tx
      .select({ review: documentReviews, document: documentsTable })
      .from(documentReviews)
      .innerJoin(documentsTable, eq(documentsTable.id, documentReviews.documentId))
      .where(
        and(
          eq(documentReviews.projectId, projectId),
          eq(documentReviews.status, 'open'),
          isNull(documentsTable.deletedAt),
          hidden.size ? notInArray(documentsTable.folderId, [...hidden]) : undefined,
        ),
      )
      .orderBy(asc(documentReviews.dueAt), asc(documentReviews.createdAt))
      .limit(200);
    const steps = await stepsOf(
      scope,
      rows.map((r) => r.review.id),
    );
    const out = rows.map((r) => ({
      document: r.document,
      ...view(
        r.review,
        steps.filter((s) => s.reviewId === r.review.id),
        r.document.currentRevisionId,
      ),
    }));
    return opts.overdueOnly ? out.filter((o) => o.overdueDays > 0) : out;
  }

  /** People who decided reviews on documents of the same type before, most frequent first (rules only). */
  async function suggestions(scope: TenantScope, projectId: string, documentId: string) {
    const { document } = await documents.detail(scope, projectId, documentId);
    const sameKind = document.docType
      ? eq(documentsTable.docType, document.docType)
      : document.discipline
        ? eq(documentsTable.discipline, document.discipline)
        : null;
    if (!sameKind) return [];
    const history = await scope.tx
      .select({ userId: documentReviewSteps.userId, role: documentReviewSteps.role })
      .from(documentReviewSteps)
      .innerJoin(documentsTable, eq(documentsTable.id, documentReviewSteps.documentId))
      .where(
        and(
          eq(documentReviewSteps.projectId, projectId),
          inArray(documentReviewSteps.status, ['approved', 'approved_with_comments', 'rejected']),
          sameKind,
        ),
      )
      .limit(500);
    const ranked = suggestReviewers(history, 8);
    const out: typeof ranked = [];
    for (const r of ranked) {
      const isMember = await c.requireMembers(scope, projectId, [r.userId], 'userId').then(
        () => true,
        () => false,
      );
      if (isMember) out.push(r);
      if (out.length === 5) break;
    }
    return out;
  }

  return { forDocument, start, decide, cancel, reassign, openReviews, suggestions };
}

export type ReviewService = ReturnType<typeof createReviewService>;
