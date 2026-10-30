// Online site inductions (product/14 I1–I7, X58, compliance/04): the builder's induction and draft, published
// versions, each worker's completion (progress, quiz, declaration and signature), white cards and licences, and
// the gate rule that reads them (G2, G3).
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { INDUCTION_FIXED_TEXT } from '@archova/mod-ai';
import { localDateOf, type LocalDate } from '@archova/time';
import type { EligibilityReason } from '../domain/attendance';
import {
  FAILED_ATTEMPTS_BEFORE_OFFICE,
  addMonths,
  canonicalJson,
  completionStatus,
  contentHash,
  contentProblems,
  normaliseContent,
  requiredVersion,
  scoreQuiz,
  sectionHash,
  sha256,
  templateContent,
  type ContentProblem,
  type InductionContent,
} from '../domain/induction';
import {
  attendanceSessions,
  inductionCompletions,
  inductionQuizAttempts,
  inductionVersions,
  inductions,
  workerCredentials,
  workers,
  type CredentialKind,
  type SectionApproval,
} from '../infra/tables';
import type {
  AttendanceService,
  ComplianceSource,
  Viewer,
  WorkerRow,
  WorkforceDeps,
} from './attendance';

export type InductionRow = typeof inductions.$inferSelect;
export type VersionRow = typeof inductionVersions.$inferSelect;
export type CompletionRow = typeof inductionCompletions.$inferSelect;
export type AttemptRow = typeof inductionQuizAttempts.$inferSelect;
export type CredentialRow = typeof workerCredentials.$inferSelect;

export interface InductionDetail {
  row: InductionRow;
  versions: VersionRow[];
  current: VersionRow | null;
  required: VersionRow | null;
  problems: ContentProblem[];
}

export interface CompletionView {
  completion: CompletionRow;
  version: VersionRow;
  worker: WorkerRow;
  attempts: AttemptRow[];
  credentials: CredentialRow[];
  /** Quiz question ids in the order this worker sees them. */
  quizOrder: string[];
  viewer: Viewer;
}

export interface CredentialInput {
  kind: CredentialKind;
  number: string;
  issuingState?: string;
  licenceClass?: string;
  issuedOn?: string;
  expiresOn?: string;
  fileIds: string[];
}

export interface SignInput {
  typedName: string;
  signature: { format: 'svg'; data: string };
  fitForWork: boolean;
  agreed: boolean;
  clientAt?: Date;
}

export interface RequestFacts {
  ip: string;
  userAgent: string | null;
}

export type InductionDeps = WorkforceDeps & {
  files: {
    getFile(
      scope: TenantScope,
      fileId: string,
      opts?: { authorised?: boolean },
    ): Promise<{ projectId: string | null; status: string; createdBy: string | null }>;
    downloadUrl(
      scope: TenantScope,
      fileId: string,
      opts: { authorised: boolean },
    ): Promise<{ url: string; expiresAt: Date }>;
  };
  documents: {
    getDocumentRef(
      scope: TenantScope,
      projectId: string,
      documentId: string,
    ): Promise<{ id: string; title: string; docNumber: string | null }>;
  };
};

const newQuestionId = () => 'q' + randomBytes(6).toString('hex');

/** A worker on an access link (X45) sees only their own record; the scope's actor says which worker. */
const GUEST_VIEWER: Viewer = {
  scopedCompanyId: null,
  canManage: false,
  canOverride: false,
  canSeePersonal: false,
};
const linkWorker = (scope: TenantScope) =>
  scope.ctx.actor?.type === 'link' ? scope.ctx.actor.subjectId : undefined;

export function createInductionService(deps: InductionDeps, attendance: AttendanceService) {
  const now = deps.now ?? (() => new Date());

  const can = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.can(scope, key, { projectId });

  async function today(scope: TenantScope, projectId: string): Promise<LocalDate> {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  // ------------------------------------------------------------------------------------------- builder

  async function getRow(scope: TenantScope, projectId: string, inductionId: string) {
    const [row] = await scope.tx
      .select()
      .from(inductions)
      .where(and(eq(inductions.id, inductionId), eq(inductions.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('induction.not_found');
    return row;
  }

  async function versionsOf(scope: TenantScope, inductionIds: string[]) {
    if (!inductionIds.length) return [];
    return scope.tx
      .select()
      .from(inductionVersions)
      .where(inArray(inductionVersions.inductionId, inductionIds))
      .orderBy(desc(inductionVersions.number));
  }

  function unapproved(row: InductionRow): ContentProblem[] {
    if (!row.draftAiSuggestionId) return [];
    return row.draft.sections.flatMap((s, i) =>
      row.draftApprovals[String(i)]?.hash === sectionHash(row.draft, i)
        ? []
        : [
            {
              path: `sections/${i}/approval`,
              message: `"${s.title}" was drafted by Nova. Read it and approve it before publishing.`,
            },
          ],
    );
  }

  function detailOf(row: InductionRow, all: VersionRow[]): InductionDetail {
    const versions = all.filter((v) => v.inductionId === row.id);
    return {
      row,
      versions,
      current: versions.find((v) => v.id === row.currentVersionId) ?? null,
      required: requiredVersion(versions, now()),
      problems: [...contentProblems(row.draft), ...unapproved(row)],
    };
  }

  async function detail(scope: TenantScope, row: InductionRow) {
    return detailOf(row, await versionsOf(scope, [row.id]));
  }

  async function list(scope: TenantScope, projectId: string) {
    const rows = await scope.tx
      .select()
      .from(inductions)
      .where(eq(inductions.projectId, projectId))
      .orderBy(asc(inductions.createdAt), asc(inductions.id));
    const all = await versionsOf(
      scope,
      rows.map((r) => r.id),
    );
    return rows.map((r) => detailOf(r, all));
  }

  async function get(scope: TenantScope, projectId: string, inductionId: string) {
    return detail(scope, await getRow(scope, projectId, inductionId));
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: { title: string; siteId?: string; validityMonths?: number },
  ) {
    await deps.platform.getProject(scope, projectId);
    if (input.siteId) await attendance.getSite(scope, projectId, input.siteId);
    try {
      const [row] = await scope.tx
        .insert(inductions)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          siteId: input.siteId ?? null,
          title: input.title.trim(),
          draft: templateContent(),
          ...(input.validityMonths ? { validityMonths: input.validityMonths } : {}),
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      return detail(scope, row!);
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      if (err.code === '23505' || err.cause?.code === '23505')
        throw new AppError(
          'induction.exists',
          input.siteId
            ? 'This site already has an induction. Publish a new version of it instead.'
            : 'This project already has an induction. Publish a new version of it instead.',
        );
      throw e;
    }
  }

  async function write(
    scope: TenantScope,
    row: InductionRow,
    expected: number,
    set: Partial<typeof inductions.$inferInsert>,
  ) {
    const [updated] = await scope.tx
      .update(inductions)
      .set({ ...set, version: row.version + 1, updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(and(eq(inductions.id, row.id), eq(inductions.version, expected)))
      .returning();
    if (!updated) throw versionConflict();
    return updated;
  }

  async function editable(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    expected: number,
  ) {
    const row = await getRow(scope, projectId, inductionId);
    if (row.version !== expected) throw versionConflict();
    if (row.status === 'archived')
      throw new AppError('induction.archived', 'This induction is archived.');
    return row;
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    expected: number,
    patch: { title?: string; validityMonths?: number; status?: 'archived' },
  ) {
    const row = await editable(scope, projectId, inductionId, expected);
    const updated = await write(scope, row, expected, {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.validityMonths !== undefined ? { validityMonths: patch.validityMonths } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    });
    return detail(scope, updated);
  }

  /** Files must be ready in this project; a SWMS must be a document the caller can open (its title is copied). */
  async function resolveReferences(scope: TenantScope, projectId: string, c: InductionContent) {
    const sections = [];
    for (const [i, s] of c.sections.entries()) {
      const blocks = [];
      for (const [j, b] of s.blocks.entries()) {
        const path = `content/sections/${i}/blocks/${j}`;
        if (b.type === 'video' || b.type === 'document' || b.type === 'image') {
          const f = await deps.files.getFile(scope, b.fileId).catch(() => null);
          if (!f || f.projectId !== projectId || f.status !== 'ready')
            throw new AppError('file.not_in_project', 'Use files uploaded to this project.', [
              { path: `${path}/fileId`, message: 'Not a ready file in this project' },
            ]);
          blocks.push(b);
        } else if (b.type === 'swms') {
          const doc = await deps.documents
            .getDocumentRef(scope, projectId, b.documentId)
            .catch(() => null);
          if (!doc)
            throw new AppError('document.not_found', 'Pick a SWMS from the project documents.', [
              { path: `${path}/documentId`, message: 'Unknown document' },
            ]);
          blocks.push({
            ...b,
            title: doc.docNumber ? `${doc.docNumber} ${doc.title}` : doc.title,
          });
        } else blocks.push(b);
      }
      sections.push({ ...s, blocks });
    }
    return { ...c, sections };
  }

  async function saveDraft(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    expected: number,
    input: { content: InductionContent; aiSuggestionId?: string },
  ) {
    const row = await editable(scope, projectId, inductionId, expected);
    const content = normaliseContent(
      await resolveReferences(scope, projectId, input.content),
      newQuestionId,
    );
    // An approval stands while its section is unchanged.
    const approvals: Record<string, SectionApproval> = {};
    for (const [i, a] of Object.entries(row.draftApprovals))
      if (Number(i) < content.sections.length && a.hash === sectionHash(content, Number(i)))
        approvals[i] = a;
    const updated = await write(scope, row, expected, {
      draft: content,
      draftApprovals: approvals,
      ...(input.aiSuggestionId ? { draftAiSuggestionId: input.aiSuggestionId } : {}),
    });
    return detail(scope, updated);
  }

  async function approveSection(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    expected: number,
    index: number,
  ) {
    const row = await editable(scope, projectId, inductionId, expected);
    if (index >= row.draft.sections.length)
      throw new AppError('validation_failed', 'No such section.', [
        { path: 'section', message: 'Out of range' },
      ]);
    const updated = await write(scope, row, expected, {
      draftApprovals: {
        ...row.draftApprovals,
        [String(index)]: {
          by: scope.ctx.userId,
          at: now().toISOString(),
          hash: sectionHash(row.draft, index),
        },
      },
    });
    return detail(scope, updated);
  }

  async function publish(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    expected: number,
    input: { redo: 'all' | 'none'; graceDays?: number; changeNote?: string },
  ) {
    const row = await editable(scope, projectId, inductionId, expected);
    const problems = contentProblems(row.draft);
    if (problems.length)
      throw new AppError(
        'induction.incomplete',
        'The induction is missing required content.',
        problems,
      );
    const notApproved = unapproved(row);
    if (notApproved.length)
      throw new AppError(
        'induction.not_approved',
        'Approve every Nova-drafted section first.',
        notApproved,
      );
    const versions = await versionsOf(scope, [row.id]);
    const first = versions.length === 0;
    const at = now();
    const graceDays = first ? 0 : (input.graceDays ?? 0);
    const declarationText = INDUCTION_FIXED_TEXT.declaration;
    const [version] = await scope.tx
      .insert(inductionVersions)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        inductionId: row.id,
        number: (versions[0]?.number ?? 0) + 1,
        content: row.draft,
        declarationText,
        contentHash: contentHash(row.draft, declarationText),
        // Nobody has done the first version yet, so everyone takes it.
        redo: first ? 'all' : input.redo,
        graceDays,
        requiredFrom: new Date(at.getTime() + graceDays * 86_400_000),
        changeNote: input.changeNote?.trim() || null,
        aiSuggestionId: row.draftAiSuggestionId,
        approvedBy: row.draftAiSuggestionId
          ? [...new Set(Object.values(row.draftApprovals).map((a) => a.by))]
          : [],
        publishedAt: at,
        publishedBy: scope.ctx.userId,
      })
      .returning();
    const updated = await write(scope, row, expected, {
      status: 'published',
      currentVersionId: version!.id,
      draftAiSuggestionId: null,
      draftApprovals: {},
    });
    scope.events.add({
      type: 'workforce.induction.version.published.v1',
      projectId,
      entityType: 'induction',
      entityId: row.id,
      entityVersion: updated.version,
      data: {
        inductionId: row.id,
        versionId: version!.id,
        number: version!.number,
        redo: version!.redo,
        requiredFrom: version!.requiredFrom.toISOString(),
      },
    });
    return { version: version!, induction: updated };
  }

  async function getVersion(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    versionId: string,
  ) {
    const [row] = await scope.tx
      .select()
      .from(inductionVersions)
      .where(
        and(
          eq(inductionVersions.id, versionId),
          eq(inductionVersions.inductionId, inductionId),
          eq(inductionVersions.projectId, projectId),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('induction.version_not_found');
    return row;
  }

  /** For `ai` (ai/12 §3): a published version's slides and quiz, without answers. Internal ids. */
  async function versionForAi(scope: TenantScope, versionId: string) {
    const [v] = await scope.tx
      .select()
      .from(inductionVersions)
      .where(eq(inductionVersions.id, versionId))
      .limit(1);
    if (!v) throw new AppError('induction.version_not_found');
    return aiContent(v);
  }

  // ---------------------------------------------------------------------------------------- the worker

  /** The induction workers take at this site: the site's own, or else the whole project's. */
  async function activeInduction(scope: TenantScope, projectId: string, siteId: string | null) {
    const rows = await scope.tx
      .select()
      .from(inductions)
      .where(and(eq(inductions.projectId, projectId), eq(inductions.status, 'published')));
    return (
      (siteId ? rows.find((r) => r.siteId === siteId) : undefined) ??
      rows.find((r) => r.siteId === null) ??
      (siteId ? undefined : rows[0]) ??
      null
    );
  }

  async function attemptsOf(scope: TenantScope, completionId: string) {
    return scope.tx
      .select()
      .from(inductionQuizAttempts)
      .where(eq(inductionQuizAttempts.completionId, completionId))
      .orderBy(asc(inductionQuizAttempts.attempt));
  }

  async function credentialsOf(scope: TenantScope, workerIds: string[]) {
    if (!workerIds.length) return [];
    return scope.tx
      .select()
      .from(workerCredentials)
      .where(inArray(workerCredentials.workerId, workerIds))
      .orderBy(asc(workerCredentials.createdAt), asc(workerCredentials.id));
  }

  /** Shuffled per completion (compliance/04 §3), the same every time this worker opens it. */
  const quizOrder = (c: CompletionRow, v: VersionRow) =>
    v.content.quiz
      .map((q) => ({ id: q.id, k: sha256(`${c.id}:${q.id}`) }))
      .sort((a, b) => (a.k < b.k ? -1 : 1))
      .map((q) => q.id);

  async function view(
    scope: TenantScope,
    c: CompletionRow,
    viewer: Viewer,
  ): Promise<CompletionView> {
    const [[version], worker, attempts, credentials] = await Promise.all([
      scope.tx
        .select()
        .from(inductionVersions)
        .where(eq(inductionVersions.id, c.versionId))
        .limit(1),
      attendance.getWorker(scope, c.workerId),
      attemptsOf(scope, c.id),
      credentialsOf(scope, [c.workerId]),
    ]);
    return {
      completion: c,
      version: version!,
      worker,
      attempts,
      credentials,
      quizOrder: quizOrder(c, version!),
      viewer,
    };
  }

  /** The worker's own completion, or any on the project for someone who runs the gate or the induction. */
  async function loadCompletion(scope: TenantScope, projectId: string, completionId: string) {
    const [c] = await scope.tx
      .select()
      .from(inductionCompletions)
      .where(
        and(
          eq(inductionCompletions.id, completionId),
          eq(inductionCompletions.projectId, projectId),
        ),
      )
      .limit(1);
    if (!c) throw new AppError('induction.completion_not_found');
    const guest = linkWorker(scope);
    if (guest !== undefined) {
      if (c.workerId !== guest) throw new AppError('induction.completion_not_found');
      return {
        completion: c,
        viewer: GUEST_VIEWER,
        worker: await attendance.getWorker(scope, c.workerId),
      };
    }
    const viewer = await attendance.viewer(scope, projectId);
    const worker = await attendance.getWorker(scope, c.workerId);
    const mine = worker.userId === scope.ctx.userId;
    if (!mine && !viewer.canManage && !(await can(scope, 'workforce.inductions.manage', projectId)))
      throw new AppError('induction.completion_not_found');
    return { completion: c, viewer, worker };
  }

  async function start(
    scope: TenantScope,
    projectId: string,
    input: { siteId?: string; workerId?: string },
  ) {
    const viewer = await attendance.viewer(scope, projectId);
    let worker: WorkerRow;
    if (input.workerId) {
      if (!viewer.canManage)
        throw new AppError('access.denied', 'Only a site manager can induct someone else.');
      worker = await attendance.getWorker(scope, input.workerId);
    } else worker = await attendance.selfWorker(scope, projectId);
    if (input.siteId) await attendance.getSite(scope, projectId, input.siteId);
    const induction = await activeInduction(scope, projectId, input.siteId ?? null);
    if (!induction?.currentVersionId)
      throw new AppError('induction.not_published', 'This site has no induction to take yet.');
    const [existing] = await scope.tx
      .select()
      .from(inductionCompletions)
      .where(
        and(
          eq(inductionCompletions.versionId, induction.currentVersionId),
          eq(inductionCompletions.workerId, worker.id),
        ),
      )
      .limit(1);
    if (existing) return view(scope, existing, viewer);
    const [row] = await scope.tx
      .insert(inductionCompletions)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        inductionId: induction.id,
        versionId: induction.currentVersionId,
        workerId: worker.id,
        method: input.workerId ? 'assisted' : 'self',
        assistedBy: input.workerId ? scope.ctx.userId : null,
        startedAt: now(),
      })
      .returning();
    return view(scope, row!, viewer);
  }

  /**
   * Access link (X45): start, or pick up again, the verified worker's completion of the link's induction on its
   * current version. The verified number goes on the completion and into the signed evidence.
   */
  async function startForLink(
    scope: TenantScope,
    projectId: string,
    inductionId: string,
    workerId: string,
    link: { linkId: string; channel: 'sms' | 'email'; verifiedTo: string },
  ) {
    const row = await getRow(scope, projectId, inductionId);
    if (row.status === 'archived' || !row.currentVersionId)
      throw new AppError('induction.not_published', 'This site has no induction to take yet.');
    const [existing] = await scope.tx
      .select()
      .from(inductionCompletions)
      .where(
        and(
          eq(inductionCompletions.versionId, row.currentVersionId),
          eq(inductionCompletions.workerId, workerId),
        ),
      )
      .limit(1);
    if (existing) return existing;
    const [created] = await scope.tx
      .insert(inductionCompletions)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        inductionId,
        versionId: row.currentVersionId,
        workerId,
        method: 'link',
        accessLinkId: link.linkId,
        verifiedChannel: link.channel,
        verifiedTo: link.verifiedTo,
        startedAt: now(),
      })
      .returning();
    return created!;
  }

  /** The worker's latest completion of an induction (in progress first), for the access-link pages. */
  async function latestCompletion(scope: TenantScope, inductionId: string, workerId: string) {
    const [c] = await scope.tx
      .select()
      .from(inductionCompletions)
      .where(
        and(
          eq(inductionCompletions.inductionId, inductionId),
          eq(inductionCompletions.workerId, workerId),
        ),
      )
      .orderBy(
        sql`case when ${inductionCompletions.status} = 'in_progress' then 0 else 1 end`,
        desc(inductionCompletions.startedAt),
      )
      .limit(1);
    return c ?? null;
  }

  /** Keeps the language the worker reads in, and what they saw, for the evidence (ai/12 I4). */
  async function recordLanguage(
    scope: TenantScope,
    projectId: string,
    completionId: string,
    language: string,
    translationHash: string | null,
  ) {
    const { completion } = await loadCompletion(scope, projectId, completionId);
    if (completion.status === 'completed') return completion;
    if (completion.language === language && completion.translationHash === translationHash)
      return completion;
    return saveCompletion(scope, completion, { language, translationHash });
  }

  async function getCompletion(scope: TenantScope, projectId: string, completionId: string) {
    const { completion, viewer } = await loadCompletion(scope, projectId, completionId);
    return view(scope, completion, viewer);
  }

  /**
   * A video, PDF or image the worker's own induction uses, and nothing else. A worker holding only the sign-in
   * permission has no `files.objects.read`, so the completion (theirs, or a manager's to see) is the grant.
   */
  async function downloadFile(
    scope: TenantScope,
    projectId: string,
    completionId: string,
    fileId: string,
  ) {
    const { completion } = await loadCompletion(scope, projectId, completionId);
    const [version] = await scope.tx
      .select({ content: inductionVersions.content })
      .from(inductionVersions)
      .where(eq(inductionVersions.id, completion.versionId));
    const used = version?.content.sections.some((sec) =>
      sec.blocks.some((b) => 'fileId' in b && b.fileId === fileId),
    );
    if (!used) throw new AppError('file.not_found');
    // Last gate: the file itself must belong to this project, whatever the content says.
    const file = await deps.files.getFile(scope, fileId, { authorised: true }).catch(() => null);
    if (!file || file.projectId !== projectId) throw new AppError('file.not_found');
    return deps.files.downloadUrl(scope, fileId, { authorised: true });
  }

  async function inProgress(scope: TenantScope, projectId: string, completionId: string) {
    const loaded = await loadCompletion(scope, projectId, completionId);
    if (loaded.completion.status === 'completed')
      throw new AppError('induction.completed', 'This induction is already signed.');
    return loaded;
  }

  async function saveCompletion(
    scope: TenantScope,
    c: CompletionRow,
    set: Partial<typeof inductionCompletions.$inferInsert>,
  ) {
    const [row] = await scope.tx
      .update(inductionCompletions)
      .set({ ...set, version: c.version + 1, updatedAt: now() })
      .where(and(eq(inductionCompletions.id, c.id), eq(inductionCompletions.version, c.version)))
      .returning();
    if (!row) throw versionConflict();
    return row;
  }

  async function recordProgress(
    scope: TenantScope,
    projectId: string,
    completionId: string,
    input: { section: number; seconds?: number },
  ) {
    const { completion, viewer } = await inProgress(scope, projectId, completionId);
    const [version] = await scope.tx
      .select({ content: inductionVersions.content })
      .from(inductionVersions)
      .where(eq(inductionVersions.id, completion.versionId));
    if (input.section >= version!.content.sections.length)
      throw new AppError('validation_failed', 'No such section.', [
        { path: 'section', message: 'Out of range' },
      ]);
    const key = String(input.section);
    const prev = completion.progress[key];
    const row = await saveCompletion(scope, completion, {
      progress: {
        ...completion.progress,
        [key]: { at: now().toISOString(), seconds: (prev?.seconds ?? 0) + (input.seconds ?? 0) },
      },
    });
    return view(scope, row, viewer);
  }

  async function submitQuiz(
    scope: TenantScope,
    projectId: string,
    completionId: string,
    answers: Array<{ questionId: string; answerIndex: number }>,
  ) {
    const { completion, worker } = await inProgress(scope, projectId, completionId);
    const [version] = await scope.tx
      .select()
      .from(inductionVersions)
      .where(eq(inductionVersions.id, completion.versionId));
    const content = version!.content;
    const unseen = content.sections.some((_, i) => !completion.progress[String(i)]);
    if (unseen)
      throw new AppError(
        'induction.sections_not_viewed',
        'Go through every section before the quiz.',
      );
    const given: Record<string, number> = {};
    for (const a of answers) given[a.questionId] = a.answerIndex;
    const result = scoreQuiz(content, given);
    const previous = await attemptsOf(scope, completion.id);
    const attempt = previous.length + 1;
    await scope.tx.insert(inductionQuizAttempts).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      completionId: completion.id,
      attempt,
      questions: quizOrder(completion, version!),
      answers: given,
      score: result.score,
      criticalOk: result.criticalOk,
      passed: result.passed,
      submittedAt: now(),
    });
    if (result.passed && !completion.quizPassedAt)
      await saveCompletion(scope, completion, { quizPassedAt: now(), quizScore: result.score });
    const failed = previous.filter((p) => !p.passed).length + (result.passed ? 0 : 1);
    const seeSiteOffice = !result.passed && failed >= FAILED_ATTEMPTS_BEFORE_OFFICE;
    if (!result.passed && failed === FAILED_ATTEMPTS_BEFORE_OFFICE)
      // The site manager is told (compliance/04 §3).
      scope.events.add({
        type: 'workforce.induction.quiz_failed.v1',
        projectId,
        entityType: 'worker',
        entityId: worker.id,
        data: { completionId: completion.id, workerId: worker.id, failedAttempts: failed },
      });
    return { attempt, ...result, seeSiteOffice };
  }

  async function insertCredential(
    scope: TenantScope,
    projectId: string,
    workerId: string,
    input: CredentialInput,
  ) {
    if (input.kind === 'white_card' && !input.issuingState)
      throw new AppError('validation_failed', 'Enter the state that issued the white card.', [
        { path: 'issuingState', message: 'Required for a white card' },
      ]);
    const guest = linkWorker(scope) !== undefined;
    for (const [i, fileId] of input.fileIds.entries()) {
      // On a link the photo must be one this worker uploaded on it.
      const f = await deps.files
        .getFile(scope, fileId, guest ? { authorised: true } : undefined)
        .catch(() => null);
      if (
        !f ||
        f.projectId !== projectId ||
        f.status !== 'ready' ||
        (guest && f.createdBy !== scope.ctx.userId)
      )
        throw new AppError('file.not_in_project', 'Upload the photo to this project first.', [
          { path: `fileIds/${i}`, message: 'Not a ready file in this project' },
        ]);
    }
    const [row] = await scope.tx
      .insert(workerCredentials)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        workerId,
        kind: input.kind,
        number: input.number.trim(),
        issuingState: input.issuingState ?? null,
        licenceClass: input.licenceClass?.trim() || null,
        issuedOn: input.issuedOn ?? null,
        expiresOn: input.expiresOn ?? null,
        fileIds: input.fileIds,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function addInductionCredential(
    scope: TenantScope,
    projectId: string,
    completionId: string,
    input: CredentialInput,
  ) {
    const { completion } = await inProgress(scope, projectId, completionId);
    return insertCredential(scope, projectId, completion.workerId, input);
  }

  /** Card images: the builder's site managers and people allowed personal details, or the worker's own company (IND-AC12). */
  function mayReadCredentials(v: Viewer, w: WorkerRow) {
    return (
      v.canManage ||
      v.canSeePersonal ||
      (v.scopedCompanyId !== null && v.scopedCompanyId === w.companyId)
    );
  }

  async function workerForCredentials(scope: TenantScope, projectId: string, workerId: string) {
    const v = await attendance.viewer(scope, projectId);
    const w = await attendance.getWorker(scope, workerId, v);
    if (!mayReadCredentials(v, w))
      throw new AppError(
        'access.denied',
        "Only site managers and the worker's own company can see their cards.",
      );
    return w;
  }

  async function listCredentials(scope: TenantScope, projectId: string, workerId: string) {
    const w = await workerForCredentials(scope, projectId, workerId);
    return credentialsOf(scope, [w.id]);
  }

  async function addCredential(
    scope: TenantScope,
    projectId: string,
    workerId: string,
    input: CredentialInput,
  ) {
    const w = await workerForCredentials(scope, projectId, workerId);
    return insertCredential(scope, projectId, w.id, input);
  }

  async function sightCredential(
    scope: TenantScope,
    projectId: string,
    workerId: string,
    credentialId: string,
    expected: number,
  ) {
    const w = await workerForCredentials(scope, projectId, workerId);
    const [cred] = await scope.tx
      .select()
      .from(workerCredentials)
      .where(and(eq(workerCredentials.id, credentialId), eq(workerCredentials.workerId, w.id)))
      .limit(1);
    if (!cred) throw new AppError('credential.not_found');
    if (cred.version !== expected) throw versionConflict();
    const at = now();
    const [row] = await scope.tx
      .update(workerCredentials)
      .set({
        status: 'sighted',
        sightedBy: scope.ctx.userId,
        sightedAt: at,
        version: cred.version + 1,
        updatedAt: at,
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(workerCredentials.id, cred.id), eq(workerCredentials.version, expected)))
      .returning();
    if (!row) throw versionConflict();
    return row;
  }

  async function sign(
    scope: TenantScope,
    projectId: string,
    completionId: string,
    input: SignInput,
    req: RequestFacts,
  ) {
    const { completion, worker, viewer } = await inProgress(scope, projectId, completionId);
    if (!completion.quizPassedAt)
      throw new AppError('induction.quiz_not_passed', 'Pass the quiz before signing.');
    if (!input.fitForWork || !input.agreed)
      throw new AppError('validation_failed', 'Confirm the declaration to finish.', [
        ...(!input.fitForWork ? [{ path: 'fitForWork', message: 'Must be confirmed' }] : []),
        ...(!input.agreed ? [{ path: 'agreed', message: 'Must be confirmed' }] : []),
      ]);
    const credentials = await credentialsOf(scope, [worker.id]);
    if (worker.kind === 'worker' && !credentials.some((c) => c.kind === 'white_card'))
      throw new AppError(
        'induction.white_card_required',
        'Add a photo of your white card before signing.',
      );
    const [[version], [induction], attempts, project] = await Promise.all([
      scope.tx
        .select()
        .from(inductionVersions)
        .where(eq(inductionVersions.id, completion.versionId)),
      scope.tx.select().from(inductions).where(eq(inductions.id, completion.inductionId)),
      attemptsOf(scope, completion.id),
      deps.platform.getProject(scope, projectId),
    ]);
    const at = now();
    const deviceAt = input.clientAt ?? null;
    const expiresOn = addMonths(localDateOf(at, project.timezone), induction!.validityMonths);
    // Sealed with the record (compliance/04 §3): anyone can recompute it from the row and its attempts.
    const evidence = {
      completionId: completion.id,
      worker: { id: worker.id, fullName: worker.fullName, companyId: worker.companyId },
      inductionId: completion.inductionId,
      versionId: version!.id,
      versionNumber: version!.number,
      contentHash: version!.contentHash,
      language: completion.language,
      translationHash: completion.translationHash,
      method: completion.method,
      assistedBy: completion.assistedBy,
      ...(completion.method === 'link'
        ? {
            accessLinkId: completion.accessLinkId,
            verifiedChannel: completion.verifiedChannel,
            verifiedTo: completion.verifiedTo,
          }
        : {}),
      startedAt: completion.startedAt.toISOString(),
      progress: completion.progress,
      attempts: attempts.map((a) => ({
        attempt: a.attempt,
        questions: a.questions,
        answers: a.answers,
        score: a.score,
        passed: a.passed,
        at: a.submittedAt.toISOString(),
      })),
      declarationText: version!.declarationText,
      typedName: input.typedName.trim(),
      signatureSha256: sha256(input.signature.data),
      fitForWork: true,
      agreedAt: at.toISOString(),
      deviceAt: deviceAt?.toISOString() ?? null,
      ip: req.ip,
      userAgent: req.userAgent,
    };
    const row = await saveCompletion(scope, completion, {
      status: 'completed',
      completedAt: at,
      expiresOn,
      typedName: input.typedName.trim(),
      signatureFormat: input.signature.format,
      signatureData: input.signature.data,
      declarationText: version!.declarationText,
      fitForWork: true,
      deviceAt,
      ip: req.ip,
      userAgent: req.userAgent,
      evidenceHash: sha256(canonicalJson(evidence)),
    });
    scope.events.add({
      type: 'workforce.induction.completed.v1',
      projectId,
      entityType: 'induction_completion',
      entityId: row.id,
      entityVersion: row.version,
      data: {
        completionId: row.id,
        workerId: worker.id,
        companyId: worker.companyId,
        inductionId: row.inductionId,
        versionId: row.versionId,
        versionNumber: version!.number,
        expiresOn,
      },
    });
    return view(scope, row, viewer);
  }

  // ---------------------------------------------------------------------------------- gate and register

  async function bestCompletions(scope: TenantScope, inductionId: string, workerIds: string[]) {
    if (!workerIds.length) return new Map<string, CompletionRow & { versionNumber: number }>();
    const rows = await scope.tx
      .select({ c: inductionCompletions, number: inductionVersions.number })
      .from(inductionCompletions)
      .innerJoin(inductionVersions, eq(inductionVersions.id, inductionCompletions.versionId))
      .where(
        and(
          eq(inductionCompletions.inductionId, inductionId),
          inArray(inductionCompletions.workerId, workerIds),
        ),
      );
    // A signed completion beats one in progress; then the newest version.
    const rank = (r: { c: CompletionRow; number: number }) =>
      (r.c.status === 'completed' ? 1_000_000 : 0) + r.number;
    const out = new Map<string, CompletionRow & { versionNumber: number }>();
    for (const r of rows) {
      const prev = out.get(r.c.workerId);
      if (!prev || rank(r) > rank({ c: prev, number: prev.versionNumber }))
        out.set(r.c.workerId, { ...r.c, versionNumber: r.number });
    }
    return out;
  }

  /** G2 site induction and G3 white card recorded (compliance/04 §5), registered with the X54 interface. */
  const gateSource: ComplianceSource = async (scope, q) => {
    if (q.worker.kind !== 'worker') return { reasons: [], sources: [] };
    const induction = await activeInduction(scope, q.projectId, q.siteId);
    if (!induction) return { reasons: [], sources: [] };
    const required = requiredVersion(await versionsOf(scope, [induction.id]), now());
    if (!required) return { reasons: [], sources: [] };
    const reasons: EligibilityReason[] = [];
    const sources: unknown[] = [];
    const best = (await bestCompletions(scope, induction.id, [q.worker.id])).get(q.worker.id);
    const status = completionStatus(best ?? null, required.number, q.localDate);
    if (best)
      sources.push({
        type: 'induction_completion',
        id: best.id,
        versionNumber: best.versionNumber,
        status: best.status,
      });
    if (status === 'not_inducted' || status === 'in_progress')
      reasons.push({ code: 'induction.missing', blocking: true });
    else if (status === 'needs_reinduction')
      reasons.push({
        code: 'induction.outdated',
        blocking: true,
        requiredVersion: required.number,
        completedVersion: best!.versionNumber,
      });
    else if (status === 'expired')
      reasons.push({ code: 'induction.expired', blocking: true, expiredOn: best!.expiresOn });
    const cards = (await credentialsOf(scope, [q.worker.id])).filter(
      (c) => c.kind === 'white_card',
    );
    for (const c of cards)
      sources.push({ type: 'worker_credential', id: c.id, version: c.version });
    if (!cards.length) reasons.push({ code: 'white_card.missing', blocking: true });
    return { reasons, sources };
  };

  async function register(scope: TenantScope, projectId: string, siteId?: string) {
    const viewer = await attendance.viewer(scope, projectId);
    if (siteId) await attendance.getSite(scope, projectId, siteId);
    const induction = await activeInduction(scope, projectId, siteId ?? null);
    const versions = induction ? await versionsOf(scope, [induction.id]) : [];
    const required = requiredVersion(versions, now());
    // Everyone who has signed in here or started this induction.
    const fromSessions = await scope.tx
      .selectDistinct({ id: attendanceSessions.workerId })
      .from(attendanceSessions)
      .where(
        and(
          eq(attendanceSessions.projectId, projectId),
          ...(siteId ? [eq(attendanceSessions.siteId, siteId)] : []),
        ),
      );
    const fromInduction = induction
      ? await scope.tx
          .selectDistinct({ id: inductionCompletions.workerId })
          .from(inductionCompletions)
          .where(eq(inductionCompletions.inductionId, induction.id))
      : [];
    const ids = [...new Set([...fromSessions, ...fromInduction].map((r) => r.id))];
    const rows = ids.length
      ? await scope.tx
          .select()
          .from(workers)
          .where(
            and(
              inArray(workers.id, ids),
              eq(workers.kind, 'worker'),
              ...(viewer.scopedCompanyId ? [eq(workers.companyId, viewer.scopedCompanyId)] : []),
            ),
          )
          .orderBy(asc(sql`lower(${workers.fullName})`), asc(workers.id))
      : [];
    const best = induction
      ? await bestCompletions(
          scope,
          induction.id,
          rows.map((w) => w.id),
        )
      : new Map<string, CompletionRow & { versionNumber: number }>();
    const creds = await credentialsOf(
      scope,
      rows.map((w) => w.id),
    );
    const day = await today(scope, projectId);
    return {
      induction,
      required,
      viewer,
      entries: rows.map((worker) => {
        const c = best.get(worker.id) ?? null;
        return {
          worker,
          completion: c,
          status: completionStatus(c, required?.number ?? null, day),
          credentials: creds.filter((x) => x.workerId === worker.id),
        };
      }),
    };
  }

  return {
    list,
    get,
    create,
    update,
    saveDraft,
    approveSection,
    publish,
    getVersion,
    versionForAi,
    start,
    getCompletion,
    downloadFile,
    startForLink,
    latestCompletion,
    recordLanguage,
    view,
    getRow,
    recordProgress,
    submitQuiz,
    addInductionCredential,
    listCredentials,
    addCredential,
    sightCredential,
    sign,
    gateSource,
    register,
  };
}

/** What `ai` indexes and translates (ai/12 §3): slides from slide blocks and text, the quiz without answers. */
export function aiContent(v: VersionRow) {
  return {
    inductionId: v.inductionId,
    versionId: v.id,
    projectId: v.projectId,
    version: v.number,
    slides: v.content.sections.flatMap((s) =>
      s.blocks.flatMap((b) =>
        b.type === 'slides'
          ? b.slides.map((sl) => ({ title: sl.title, points: sl.points, script: sl.script }))
          : b.type === 'text'
            ? [{ title: s.title, points: [b.body], script: [] }]
            : [],
      ),
    ),
    quiz: v.content.quiz.map((q) => ({ id: q.id, question: q.question, options: q.options })),
  };
}

export type InductionService = ReturnType<typeof createInductionService>;

/** Where each of `aiContent`'s slides comes from, in the same order: the section and block indexes. */
export function slideSources(v: VersionRow): Array<{ section: number; block: number }> {
  return v.content.sections.flatMap((s, section) =>
    s.blocks.flatMap((b, block) =>
      b.type === 'slides'
        ? b.slides.map(() => ({ section, block }))
        : b.type === 'text'
          ? [{ section, block }]
          : [],
    ),
  );
}
