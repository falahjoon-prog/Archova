import { and, asc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { encodeId, uuidv7 } from '@archova/domain';
import { localDateOf } from '@archova/time';
import {
  AppError,
  decodeCursor,
  nextNumber,
  toPage,
  versionConflict,
  type TenantScope,
  type SearchHit,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import type { PlatformApi } from '@archova/mod-platform';
import {
  DEFAULT_REVIEW_DAYS,
  applyResponse,
  ballInCourt,
  canClose,
  canEditItem,
  canSeeSubmittal,
  canSubmit,
  computeSubmitBy,
  defaultNumberLabel,
  stepDueDates,
  submitByState,
  type StepKind,
  type StepResponse,
  type SubmittalStatus,
  type SubmittalType,
  type SubmittalViewer,
} from '../domain/submittal';
import { revisions, steps, submittals } from '../infra/tables';

export type SubmittalRow = typeof submittals.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;
export type StepRow = typeof steps.$inferSelect;
export type SubmittalView = SubmittalRow & {
  submitByState: ReturnType<typeof submitByState>;
  ball: {
    side: ReturnType<typeof ballInCourt>;
    userIds: string[];
    stepId: string | null;
    dueDate: string | null;
  };
};

export interface SubmittalsDeps {
  access: AccessService;
  platform: Pick<
    PlatformApi,
    'getProject' | 'getProjectMembership' | 'getOrg' | 'contactsOfCompany'
  >;
  /** The web origin links in emails point at. */
  baseUrl?: string;
  files: Pick<FilesModule['api'], 'getFile'>;
  now?: () => Date;
}

export interface SubmittalFields {
  title?: string;
  numberLabel?: string;
  type?: SubmittalType;
  specSection?: string | null;
  responsibleCompanyId?: string | null;
  managerId?: string | null;
  requiredOnSite?: string | null;
  leadTimeDays?: number;
  reviewDays?: number;
}

export function createSubmittalService(deps: SubmittalsDeps) {
  const now = deps.now ?? (() => new Date());

  async function viewer(scope: TenantScope, projectId: string): Promise<SubmittalViewer> {
    const perms = await deps.access.effectivePermissions(scope, projectId);
    return {
      userId: scope.ctx.userId,
      companyId: perms.companyId,
      isInternal: scope.ctx.principalType === 'member',
    };
  }

  async function today(scope: TenantScope, projectId: string) {
    const project = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), project.timezone);
  }

  /** The step the revision is waiting on, if any. */
  async function pendingStepFor(scope: TenantScope, rows: SubmittalRow[]) {
    const ids = rows
      .filter((r) => r.status === 'submitted' || r.status === 'in_review')
      .map((r) => r.id);
    const out = new Map<string, StepRow>();
    if (!ids.length) return out;
    const list = await scope.tx
      .select({ s: steps, rev: revisions.revision })
      .from(steps)
      .innerJoin(revisions, eq(revisions.id, steps.revisionId))
      .where(and(inArray(steps.submittalId, ids), eq(steps.response, 'pending')))
      .orderBy(asc(steps.step));
    for (const { s, rev } of list) {
      const item = rows.find((r) => r.id === s.submittalId);
      if (item && item.currentRevision === rev && !out.has(s.submittalId))
        out.set(s.submittalId, s);
    }
    return out;
  }

  async function toViews(scope: TenantScope, rows: SubmittalRow[], localToday: string) {
    const pending = await pendingStepFor(scope, rows);
    return rows.map<SubmittalView>((r) => {
      const p = pending.get(r.id) ?? null;
      const side = ballInCourt(r.status, p ? { kind: p.kind, approverId: p.approverUserId } : null);
      return {
        ...r,
        submitByState: submitByState(r, localToday),
        ball: {
          side,
          userIds: p ? [p.approverUserId] : [],
          stepId: p?.id ?? null,
          dueDate: p?.dueDate ?? null,
        },
      };
    });
  }

  /** SQL form of `canSeeSubmittal` for the register. */
  function visibleTo(v: SubmittalViewer): SQL | null {
    if (v.isInternal) return null;
    const own = v.companyId
      ? sql`(${submittals.createdBy} = ${v.userId} or ${submittals.responsibleCompanyId} = ${v.companyId})`
      : sql`${submittals.createdBy} = ${v.userId}`;
    return sql`(${own} or (${submittals.status} <> 'draft' and exists (
      select 1 from submittals.steps st where st.submittal_id = ${submittals.id} and st.approver_user_id = ${v.userId})))`;
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      status?: SubmittalStatus;
      type?: SubmittalType;
      ballInCourt?: string;
      q?: string;
      limit: number;
      cursor?: string;
    },
  ) {
    const date = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const after = decodeCursor<{ n: number }>(opts.cursor);
    const conditions: SQL[] = [eq(submittals.projectId, projectId), isNull(submittals.deletedAt)];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    if (opts.status) conditions.push(eq(submittals.status, opts.status));
    if (opts.type) conditions.push(eq(submittals.type, opts.type));
    if (opts.ballInCourt)
      conditions.push(sql`exists (select 1 from submittals.steps st
        where st.submittal_id = ${submittals.id} and st.response = 'pending' and st.approver_user_id = ${opts.ballInCourt}
          and ${submittals.status} in ('submitted', 'in_review')
          and st.revision_id = (select r.id from submittals.revisions r
                                where r.submittal_id = ${submittals.id} and r.revision = ${submittals.currentRevision}))`);
    if (opts.q) {
      const like = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        sql`(${submittals.title} ilike ${like} or ${submittals.numberLabel} ilike ${like} or coalesce(${submittals.specSection}, '') ilike ${like})`,
      );
    }
    if (after) conditions.push(gt(submittals.number, after.n));
    const rows = await scope.tx
      .select()
      .from(submittals)
      .where(and(...conditions))
      .orderBy(asc(submittals.number))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ n: r.number }));
    return { data: await toViews(scope, page.data, date), nextCursor: page.nextCursor };
  }

  async function revisionsWithSteps(scope: TenantScope, submittalId: string) {
    const revs = await scope.tx
      .select()
      .from(revisions)
      .where(eq(revisions.submittalId, submittalId))
      .orderBy(asc(revisions.revision));
    const all = await scope.tx
      .select()
      .from(steps)
      .where(eq(steps.submittalId, submittalId))
      .orderBy(asc(steps.step));
    return revs.map((r) => ({ ...r, steps: all.filter((s) => s.revisionId === r.id) }));
  }

  async function getVisible(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(submittals)
      .where(
        and(
          eq(submittals.id, id),
          eq(submittals.projectId, projectId),
          isNull(submittals.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('submittal.not_found');
    const v = await viewer(scope, projectId);
    const revs = await revisionsWithSteps(scope, id);
    const approvers = revs.flatMap((r) => r.steps.map((s) => s.approverUserId));
    if (
      !canSeeSubmittal(
        {
          status: row.status,
          createdBy: row.createdBy,
          responsibleCompanyId: row.responsibleCompanyId,
          stepApproverIds: approvers,
        },
        v,
      )
    )
      throw new AppError('submittal.not_found');
    const date = await today(scope, projectId);
    const [view] = await toViews(scope, [row], date);
    return { submittal: view!, revisions: revs, viewer: v };
  }

  const detail = async (scope: TenantScope, projectId: string, id: string) => {
    const { submittal, revisions: revs } = await getVisible(scope, projectId, id);
    return { submittal, revisions: revs };
  };

  async function checkFiles(scope: TenantScope, projectId: string, fileIds: string[]) {
    for (const [i, fileId] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, fileId);
      // Only files this person uploaded for submittals, so a package can't point at someone else's file.
      if (
        f.projectId !== projectId ||
        f.status !== 'ready' ||
        f.module !== 'submittals' ||
        f.createdBy !== scope.ctx.userId
      )
        throw new AppError('file.not_in_project', 'Attach files you uploaded to this project.', [
          { path: `fileIds/${i}`, message: 'Not a ready file you uploaded for submittals' },
        ]);
    }
  }

  async function memberOf(scope: TenantScope, projectId: string, userId: string, path: string) {
    const m = await deps.platform.getProjectMembership(scope, projectId, userId);
    if (!m)
      throw new AppError('submittal.reviewer_not_on_project', 'Reviewers must be on the project.', [
        { path, message: 'Not a project member' },
      ]);
    return m;
  }

  function values(
    f: SubmittalFields,
    base: SubmittalRow | null,
  ): Partial<typeof submittals.$inferInsert> {
    const v: Partial<typeof submittals.$inferInsert> = {};
    if (f.title !== undefined) v.title = f.title.trim();
    if (f.numberLabel !== undefined) v.numberLabel = f.numberLabel.trim();
    if (f.type !== undefined) v.type = f.type;
    if (f.specSection !== undefined) v.specSection = f.specSection?.trim() || null;
    if (f.responsibleCompanyId !== undefined) v.responsibleCompanyId = f.responsibleCompanyId;
    if (f.managerId !== undefined) v.managerId = f.managerId;
    if (f.requiredOnSite !== undefined) v.requiredOnSite = f.requiredOnSite;
    if (f.leadTimeDays !== undefined) v.leadTimeDays = f.leadTimeDays;
    if (f.reviewDays !== undefined) v.reviewDays = f.reviewDays;
    if (
      f.requiredOnSite !== undefined ||
      f.leadTimeDays !== undefined ||
      f.reviewDays !== undefined
    )
      v.submitBy = computeSubmitBy(
        f.requiredOnSite !== undefined ? f.requiredOnSite : (base?.requiredOnSite ?? null),
        f.leadTimeDays ?? base?.leadTimeDays ?? 0,
        f.reviewDays ?? base?.reviewDays ?? DEFAULT_REVIEW_DAYS,
      );
    return v;
  }

  async function checkLabel(
    scope: TenantScope,
    projectId: string,
    label: string,
    exceptId?: string,
  ) {
    const [dup] = await scope.tx
      .select({ id: submittals.id })
      .from(submittals)
      .where(
        and(
          eq(submittals.projectId, projectId),
          eq(submittals.numberLabel, label.trim()),
          isNull(submittals.deletedAt),
        ),
      )
      .limit(1);
    if (dup && dup.id !== exceptId)
      throw new AppError('submittal.number_taken', 'That number is already used on this project.', [
        { path: 'numberLabel', message: 'Already used' },
      ]);
  }

  /** The caller's company is the one responsible. A caller with no company never matches an item with none. */
  const ownsItem = (s: SubmittalRow, v: SubmittalViewer) =>
    v.companyId !== null && s.responsibleCompanyId === v.companyId;

  async function create(
    scope: TenantScope,
    projectId: string,
    input: SubmittalFields & { title: string },
  ) {
    const v = await viewer(scope, projectId);
    await deps.platform.getProject(scope, projectId);
    if (input.managerId) await memberOf(scope, projectId, input.managerId, 'managerId');
    if (input.numberLabel) await checkLabel(scope, projectId, input.numberLabel);
    const number = await nextNumber(scope, projectId, 'submittal');
    const id = uuidv7();
    const [row] = await scope.tx
      .insert(submittals)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        type: 'shop_drawing',
        ...values(input, null),
        number,
        numberLabel: input.numberLabel?.trim() || defaultNumberLabel(number),
        title: input.title.trim(),
        status: 'draft',
        // A subcontractor's own item is theirs; builder staff review what they set up.
        // Outside users can only raise items for their own company; builder staff name the company.
        responsibleCompanyId: v.isInternal ? (input.responsibleCompanyId ?? null) : v.companyId,
        managerId: input.managerId ?? (v.isInternal ? scope.ctx.userId : null),
        submitBy: computeSubmitBy(
          input.requiredOnSite ?? null,
          input.leadTimeDays ?? 0,
          input.reviewDays ?? DEFAULT_REVIEW_DAYS,
        ),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    scope.events.add({
      type: 'submittals.submittal.created.v1',
      projectId,
      entityType: 'submittal',
      entityId: id,
      entityVersion: 1,
      data: {
        submittalId: id,
        number: row!.numberLabel,
        responsibleCompanyId: row!.responsibleCompanyId,
      },
    });
    return detail(scope, projectId, id);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    patch: SubmittalFields,
  ) {
    const { submittal, viewer: v } = await getVisible(scope, projectId, id);
    if (!canEditItem(submittal.status))
      throw new AppError(
        'submittal.invalid_transition',
        `A submittal that is ${submittal.status} can't be edited.`,
        undefined,
        { status: submittal.status },
      );
    if (!v.isInternal && !ownsItem(submittal, v))
      throw new AppError('access.denied', "You can't change this submittal.");
    if (
      !v.isInternal &&
      patch.responsibleCompanyId !== undefined &&
      patch.responsibleCompanyId !== v.companyId
    )
      throw new AppError('access.denied', 'Only the builder can change the responsible company.');
    if (submittal.version !== expectedVersion) throw versionConflict();
    if (patch.managerId) await memberOf(scope, projectId, patch.managerId, 'managerId');
    if (patch.numberLabel) await checkLabel(scope, projectId, patch.numberLabel, id);
    const [row] = await scope.tx
      .update(submittals)
      .set({
        ...values(patch, submittal),
        version: submittal.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(submittals.id, id), eq(submittals.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    scope.events.add({
      type: 'submittals.submittal.updated.v1',
      projectId,
      entityType: 'submittal',
      entityId: id,
      entityVersion: row.version,
      data: {
        submittalId: id,
        changed: Object.keys(patch),
        ...(patch.requiredOnSite !== undefined
          ? { requiredOnSite: [submittal.requiredOnSite, row.requiredOnSite] }
          : {}),
      },
    });
    return detail(scope, projectId, id);
  }

  /**
   * Sends the item for review (or resubmits it after "revise and resubmit" / "rejected"): opens the next revision
   * with its files, puts the builder first and the consultants after it, and gives each step a due date.
   */
  async function submit(
    scope: TenantScope,
    projectId: string,
    id: string,
    expectedVersion: number,
    input: { reviewerIds?: string[]; fileIds: string[]; note?: string },
  ) {
    const { submittal, revisions: revs, viewer: v } = await getVisible(scope, projectId, id);
    if (!canSubmit(submittal.status))
      throw new AppError(
        'submittal.invalid_transition',
        `A submittal that is ${submittal.status} can't be submitted.`,
        undefined,
        { status: submittal.status },
      );
    if (!v.isInternal && !ownsItem(submittal, v))
      throw new AppError(
        'access.denied',
        'Only the responsible company or the builder can submit.',
      );
    if (submittal.version !== expectedVersion) throw versionConflict();
    if (!input.fileIds.length)
      throw new AppError('submittal.incomplete', 'Attach the package to review.', [
        { path: 'fileIds', message: 'Required to submit' },
      ]);
    await checkFiles(scope, projectId, input.fileIds);
    const builderId = submittal.managerId ?? (v.isInternal ? scope.ctx.userId : null);
    if (!builderId)
      throw new AppError('submittal.incomplete', 'The builder has not named a reviewer yet.', [
        { path: 'managerId', message: 'Required to submit' },
      ]);
    // A resubmission goes back down the same review path unless the sender names a new one.
    const previous = revs.at(-1);
    const reviewerIds = [
      ...new Set(
        input.reviewerIds ??
          previous?.steps.filter((s) => s.kind === 'consultant').map((s) => s.approverUserId) ??
          [],
      ),
    ];
    const reviewers: Array<{ userId: string; companyId: string; kind: StepKind }> = [];
    const builder = await memberOf(scope, projectId, builderId, 'managerId');
    reviewers.push({ userId: builderId, companyId: builder.companyId, kind: 'builder' });
    for (const [i, userId] of reviewerIds.entries()) {
      const m = await memberOf(scope, projectId, userId, `reviewerIds/${i}`);
      reviewers.push({ userId, companyId: m.companyId, kind: 'consultant' });
    }
    const date = await today(scope, projectId);
    const dues = stepDueDates(date, submittal.reviewDays, reviewers.length);
    const revision = previous ? previous.revision + 1 : 0;
    const revisionId = uuidv7();
    await scope.tx.insert(revisions).values({
      id: revisionId,
      orgId: scope.ctx.orgId,
      submittalId: id,
      revision,
      submittedBy: scope.ctx.userId,
      submittedByCompanyId: v.companyId,
      submittedAt: now(),
      note: input.note?.trim() ?? '',
      fileIds: input.fileIds,
    });
    await scope.tx.insert(steps).values(
      reviewers.map((r, i) => ({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        submittalId: id,
        revisionId,
        step: i + 1,
        kind: r.kind,
        approverUserId: r.userId,
        companyId: r.companyId,
        dueDate: dues[i]!,
      })),
    );
    const [row] = await scope.tx
      .update(submittals)
      .set({
        status: 'submitted',
        currentRevision: revision,
        managerId: submittal.managerId ?? builderId,
        submittedAt: now(),
        returnedAt: null,
        version: submittal.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(submittals.id, id), eq(submittals.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    scope.events.add({
      type: 'submittals.submittal.submitted.v1',
      projectId,
      entityType: 'submittal',
      entityId: id,
      entityVersion: row.version,
      data: {
        submittalId: id,
        number: row.numberLabel,
        revision,
        reviewerIds: reviewers.map((r) => r.userId),
        fileIds: input.fileIds,
      },
    });
    return detail(scope, projectId, id);
  }

  /** The builder or consultant whose step it is answers it (SUB-AC3, AC4); a status applies to the whole revision. */
  async function respond(
    scope: TenantScope,
    projectId: string,
    id: string,
    stepId: string,
    input: { response: StepResponse; comments?: string; fileIds?: string[] },
  ) {
    const { submittal, revisions: revs, viewer: v } = await getVisible(scope, projectId, id);
    const revision = revs.find((r) => r.revision === submittal.currentRevision);
    const step = revision?.steps.find((s) => s.id === stepId);
    if (!revision || !step) throw new AppError('submittal_step.not_found');
    if (submittal.status !== 'submitted' && submittal.status !== 'in_review')
      throw new AppError(
        'submittal.invalid_transition',
        `A submittal that is ${submittal.status} isn't waiting for review.`,
        undefined,
        { status: submittal.status },
      );
    if (step.approverUserId !== scope.ctx.userId && !(step.kind === 'builder' && v.isInternal))
      throw new AppError('submittal.review_not_allowed', "It isn't your turn to review this.");
    const outcome = applyResponse(
      revision.steps.map((s) => ({ step: s.step, kind: s.kind, response: s.response })),
      step.step,
      input.response,
    );
    if ('error' in outcome)
      throw new AppError('submittal.invalid_transition', outcome.error, undefined, {
        status: submittal.status,
      });
    const fileIds = input.fileIds ?? [];
    await checkFiles(scope, projectId, fileIds);
    // Only a step that is still waiting can be answered, so two answers at once can't both land.
    const answered = await scope.tx
      .update(steps)
      .set({
        response: input.response,
        comments: input.comments?.trim() ?? '',
        fileIds,
        respondedAt: now(),
        respondedBy: scope.ctx.userId,
      })
      .where(and(eq(steps.id, stepId), eq(steps.response, 'pending')))
      .returning({ id: steps.id });
    if (!answered.length) throw versionConflict();
    let status: SubmittalStatus;
    if (outcome.kind === 'advance') {
      status = 'in_review';
    } else {
      status = outcome.status;
      // A status that ends the review leaves the steps after it unanswered.
      await scope.tx
        .update(steps)
        .set({ response: 'skipped' })
        .where(and(eq(steps.revisionId, revision.id), eq(steps.response, 'pending')));
      await scope.tx
        .update(revisions)
        .set({ status: outcome.status, returnedAt: now() })
        .where(eq(revisions.id, revision.id));
    }
    const [row] = await scope.tx
      .update(submittals)
      .set({
        status,
        returnedAt: outcome.kind === 'return' ? now() : null,
        version: submittal.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(submittals.id, id), eq(submittals.version, submittal.version)))
      .returning();
    if (!row) throw versionConflict();
    scope.events.add({
      type:
        outcome.kind === 'return'
          ? 'submittals.submittal.returned.v1'
          : 'submittals.submittal.step_responded.v1',
      projectId,
      entityType: 'submittal',
      entityId: id,
      entityVersion: row.version,
      data: {
        submittalId: id,
        number: row.numberLabel,
        revision: revision.revision,
        step: step.step,
        response: input.response,
        status,
        responsibleCompanyId: row.responsibleCompanyId,
        // SUB-AC5: a status that puts the ball back with the subcontractor carries the comments to their email.
        ...(outcome.kind === 'return' ? { comments: input.comments?.trim() ?? '', fileIds } : {}),
      },
    });
    return detail(scope, projectId, id);
  }

  async function close(scope: TenantScope, projectId: string, id: string, expectedVersion: number) {
    const { submittal } = await getVisible(scope, projectId, id);
    if (!canClose(submittal.status))
      throw new AppError(
        'submittal.invalid_transition',
        `A submittal that is ${submittal.status} can't be closed.`,
        undefined,
        { status: submittal.status },
      );
    if (submittal.version !== expectedVersion) throw versionConflict();
    const [row] = await scope.tx
      .update(submittals)
      .set({
        status: 'closed',
        closedAt: now(),
        version: submittal.version + 1,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(and(eq(submittals.id, id), eq(submittals.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    scope.events.add({
      type: 'submittals.submittal.closed.v1',
      projectId,
      entityType: 'submittal',
      entityId: id,
      entityVersion: row.version,
      data: { submittalId: id, number: row.numberLabel },
    });
    return detail(scope, projectId, id);
  }

  /**
   * SUB-AC5: when a review sends the item back ("revise and resubmit" or "rejected"), the email the subcontractor's
   * people get, with the reviewer's comments. Null for any other change. The caller sends it after the transaction;
   * the marked-up files stay on the submittal, behind the sign-in.
   */
  async function returnNotice(
    scope: TenantScope,
    projectId: string,
    d: { submittal: SubmittalView; revisions: Array<RevisionRow & { steps: StepRow[] }> },
  ) {
    const s = d.submittal;
    if ((s.status !== 'revise_resubmit' && s.status !== 'rejected') || !s.responsibleCompanyId)
      return null;
    const revision = d.revisions.find((r) => r.revision === s.currentRevision);
    const answered = revision?.steps
      .filter((x) => x.response === 'revise_resubmit' || x.response === 'rejected')
      .at(-1);
    const contacts = await deps.platform.contactsOfCompany(
      scope,
      projectId,
      s.responsibleCompanyId,
    );
    const to: typeof contacts = [];
    for (const c of contacts) {
      if (await deps.access.canUser(scope, c.userId, 'submittals.submittals.read', projectId))
        to.push(c);
    }
    if (!to.length || !answered) return null;
    const [org, project] = await Promise.all([
      deps.platform.getOrg(scope),
      deps.platform.getProject(scope, projectId),
    ]);
    const verdict = s.status === 'rejected' ? 'Rejected' : 'Revise and resubmit';
    const link = deps.baseUrl
      ? `${deps.baseUrl}/${org.slug}/projects/${encodeId('project', projectId)}/submittals/${encodeId('submittal', s.id)}`
      : null;
    return {
      to: to.map((c) => c.email),
      subject: `${org.name}: ${s.numberLabel} ${s.title} — ${verdict}`,
      text: [
        `${s.numberLabel} ${s.title} on ${project.name} was returned: ${verdict}.`,
        '',
        answered.comments ? `Comments:\n${answered.comments}` : 'No comments were added.',
        ...(answered.fileIds.length
          ? ['', `${answered.fileIds.length} marked-up file(s) are on the submittal.`]
          : []),
        '',
        link
          ? `Open it and resubmit: ${link}`
          : 'Sign in to Archova to see the comments and resubmit.',
      ].join('\n'),
    };
  }

  /**
   * Programme links (`scheduling`): headline details of the submittals among `ids` the caller may see, by the same rule
   * as `list`. Empty when the caller can't read submittals.
   */
  async function summariesByIds(scope: TenantScope, projectId: string, ids: readonly string[]) {
    if (!ids.length || !(await deps.access.can(scope, 'submittals.submittals.read', { projectId })))
      return [];
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(submittals.projectId, projectId),
      isNull(submittals.deletedAt),
      inArray(submittals.id, [...ids]),
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const rows = await scope.tx
      .select({
        id: submittals.id,
        numberLabel: submittals.numberLabel,
        title: submittals.title,
        status: submittals.status,
        requiredOnSite: submittals.requiredOnSite,
      })
      .from(submittals)
      .where(and(...conditions));
    return rows.map((r) => ({
      id: r.id,
      ref: r.numberLabel,
      title: r.title,
      status: r.status as string,
      dueDate: r.requiredOnSite,
      scheduleImpactDays: null as number | null,
    }));
  }

  /**
   * Meeting agenda (`meetings`, MTG-US5): submittals the caller can see that still need something and are due soon -
   * not yet approved, rejected or closed, with a required-on-site date within the next 14 days (or already past) or a
   * draft with a submit-by date within the next 7. Soonest first. `restricted` is true when the caller can't read
   * submittals at all.
   */
  async function dueForMeeting(scope: TenantScope, projectId: string, opts: { limit: number }) {
    if (!(await deps.access.can(scope, 'submittals.submittals.read', { projectId })))
      return { rows: [], truncated: false, restricted: true };
    const date = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(submittals.projectId, projectId),
      isNull(submittals.deletedAt),
      sql`${submittals.status} not in ('approved', 'approved_as_noted', 'closed', 'rejected')`,
      sql`(${submittals.requiredOnSite} <= (${date}::date + 14)
           or (${submittals.status} = 'draft' and ${submittals.submitBy} <= (${date}::date + 7)))`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const found = await scope.tx
      .select({
        id: submittals.id,
        numberLabel: submittals.numberLabel,
        title: submittals.title,
        status: submittals.status,
        requiredOnSite: submittals.requiredOnSite,
        submitBy: submittals.submitBy,
      })
      .from(submittals)
      .where(and(...conditions))
      .orderBy(sql`${submittals.requiredOnSite} asc nulls last`, asc(submittals.number))
      .limit(opts.limit + 1);
    return {
      rows: found.slice(0, opts.limit).map((r) => ({
        id: r.id,
        ref: r.numberLabel,
        title: r.title,
        detail: [
          r.status.replace(/_/g, ' '),
          r.requiredOnSite ? `required on site ${r.requiredOnSite}` : null,
          r.status === 'draft' && r.submitBy ? `submit by ${r.submitBy}` : null,
        ]
          .filter(Boolean)
          .join(', '),
      })),
      truncated: found.length > opts.limit,
      restricted: false,
    };
  }

  /**
   * Portfolio dashboard (`reporting`): submittals the caller can see that are with the reviewers (submitted, in review
   * or sent back), and those whose required-on-site date has passed.
   */
  async function portfolioCounts(scope: TenantScope, projectId: string) {
    if (!(await deps.access.can(scope, 'submittals.submittals.read', { projectId })))
      return { restricted: true, open: 0, overdue: 0 };
    const date = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(submittals.projectId, projectId),
      isNull(submittals.deletedAt),
      sql`${submittals.status} in ('submitted', 'in_review', 'revise_resubmit')`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const [row] = await scope.tx
      .select({
        open: sql<number>`count(*)::int`,
        overdue: sql<number>`(count(*) filter (where ${submittals.requiredOnSite} < ${date}::date))::int`,
      })
      .from(submittals)
      .where(and(...conditions));
    return { restricted: false, open: row?.open ?? 0, overdue: row?.overdue ?? 0 };
  }

  /** Report builder (`reporting`): submittals the caller can see, one flat row each. `state` open = with the reviewers. */
  async function reportRows(
    scope: TenantScope,
    projectId: string,
    opts: { state: 'open' | 'closed' | 'all'; limit: number },
  ) {
    if (!(await deps.access.can(scope, 'submittals.submittals.read', { projectId })))
      return { rows: [], truncated: false, restricted: true };
    const date = await today(scope, projectId);
    const v = await viewer(scope, projectId);
    const conditions: SQL[] = [
      eq(submittals.projectId, projectId),
      isNull(submittals.deletedAt),
      opts.state === 'open'
        ? sql`${submittals.status} in ('submitted', 'in_review', 'revise_resubmit')`
        : opts.state === 'closed'
          ? sql`${submittals.status} in ('approved', 'approved_as_noted', 'rejected', 'closed')`
          : sql`${submittals.status} <> 'draft'`,
    ];
    const vis = visibleTo(v);
    if (vis) conditions.push(vis);
    const found = await scope.tx
      .select({
        id: submittals.id,
        numberLabel: submittals.numberLabel,
        title: submittals.title,
        status: submittals.status,
        requiredOnSite: submittals.requiredOnSite,
        createdAt: submittals.createdAt,
      })
      .from(submittals)
      .where(and(...conditions))
      .orderBy(asc(submittals.number))
      .limit(opts.limit + 1);
    return {
      rows: found.slice(0, opts.limit).map((r) => ({
        id: r.id,
        ref: r.numberLabel,
        title: r.title,
        status: r.status as string,
        dueDate: r.requiredOnSite,
        overdue:
          ['submitted', 'in_review', 'revise_resubmit'].includes(r.status) &&
          r.requiredOnSite !== null &&
          r.requiredOnSite < date,
        createdAt: r.createdAt.toISOString(),
      })),
      truncated: found.length > opts.limit,
      restricted: false,
    };
  }

  /** Global search (`search`): the submittals the caller can see that match the words. */
  async function searchHits(scope: TenantScope, projectId: string, q: string, limit: number) {
    if (!(await deps.access.can(scope, 'submittals.submittals.read', { projectId })))
      return { restricted: true, hits: [] as SearchHit[] };
    const page = await list(scope, projectId, { q, limit });
    return {
      restricted: false,
      hits: page.data.map<SearchHit>((r) => ({
        id: r.id,
        ref: r.numberLabel,
        title: r.title,
        status: r.status,
      })),
    };
  }

  return {
    searchHits,
    list,
    detail,
    create,
    update,
    submit,
    respond,
    close,
    returnNotice,
    dueForMeeting,
    portfolioCounts,
    reportRows,
    summariesByIds,
  };
}

export type SubmittalService = ReturnType<typeof createSubmittalService>;
