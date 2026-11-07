import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, nextNumber, toPage, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { FilesModule } from '@archova/mod-files';
import { createNotifications } from '@archova/mod-notifications';
import type { PlatformApi } from '@archova/mod-platform';
import { localDateOf, type LocalDate } from '@archova/time';
import {
  answerProblem,
  canMove,
  daysLate,
  fieldProblems,
  flagsFor,
  missingRequired,
  numberLabel,
  suggestPrefill,
  type Answers,
  type AnswerValue,
  type FieldDef,
  type SubmissionFlag,
  type SubmissionStatus,
} from '../domain/forms';
import { submissions, templates } from '../infra/tables';

export type TemplateRow = typeof templates.$inferSelect;
export type SubmissionRow = typeof submissions.$inferSelect;

export interface FormsDeps {
  access: Pick<AccessService, 'can'>;
  platform: Pick<PlatformApi, 'getProject' | 'getProjectMembership'>;
  files: Pick<FilesModule['api'], 'getFile'>;
  /** Plain-text facts about an incident the caller may see (safety); used to pre-fill a form from it. */
  incidents?: {
    facts(
      scope: TenantScope,
      projectId: string,
      incidentId: string,
    ): Promise<Record<string, string>>;
  };
  now?: () => Date;
}

export interface TemplateInput {
  name: string;
  description?: string | null;
  category?: string | null;
  fields: FieldDef[];
}

export interface SubmissionView {
  row: SubmissionRow;
  template: TemplateRow;
  flags: SubmissionFlag[];
  daysLate: number;
  missing: string[];
  canFill: boolean;
  canClose: boolean;
}

const bad = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

const cleanFields = (fields: FieldDef[]): FieldDef[] =>
  fields.map((f) => ({
    id: f.id,
    section: f.section.trim() || 'General',
    label: f.label.trim(),
    type: f.type,
    required: f.required,
    helpText: f.helpText?.trim() ? f.helpText.trim() : null,
    options: f.options.map((o) => o.trim()).filter((o) => o !== ''),
    prefillKey: f.prefillKey ?? null,
  }));

export function createFormsService(deps: FormsDeps) {
  const now = deps.now ?? (() => new Date());

  const isStaff = (scope: TenantScope) => scope.ctx.principalType === 'member';
  const can = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.can(scope, key, { projectId });

  async function today(scope: TenantScope, projectId: string): Promise<LocalDate> {
    const p = await deps.platform.getProject(scope, projectId);
    return localDateOf(now(), p.timezone);
  }

  // ---- templates ----

  async function loadTemplate(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(templates)
      .where(
        and(eq(templates.id, id), eq(templates.projectId, projectId), isNull(templates.deletedAt)),
      )
      .limit(1);
    if (!row) throw new AppError('form_template.not_found');
    return row;
  }

  function requireStaff(scope: TenantScope) {
    if (!isStaff(scope)) throw new AppError('form_template.not_found');
  }

  async function listTemplates(
    scope: TenantScope,
    projectId: string,
    status?: 'draft' | 'published' | 'archived',
  ) {
    requireStaff(scope);
    await deps.platform.getProject(scope, projectId);
    const where: SQL[] = [eq(templates.projectId, projectId), isNull(templates.deletedAt)];
    if (status) where.push(eq(templates.status, status));
    return scope.tx
      .select()
      .from(templates)
      .where(and(...where))
      .orderBy(asc(templates.name), desc(templates.version))
      .limit(500);
  }

  function checkInput(input: TemplateInput): { fields: FieldDef[]; name: string } {
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (name === '' || name.length > 200) throw bad('name', 'Enter between 1 and 200 characters');
    const fields = cleanFields(input.fields);
    const problems = fieldProblems(fields);
    if (problems.length > 0)
      throw new AppError('validation_failed', 'Some fields need attention.', problems);
    return { fields, name };
  }

  async function nameFree(
    scope: TenantScope,
    projectId: string,
    name: string,
    version: number,
    exceptId?: string,
  ) {
    const rows = await scope.tx
      .select({ id: templates.id, name: templates.name })
      .from(templates)
      .where(
        and(
          eq(templates.projectId, projectId),
          eq(templates.version, version),
          isNull(templates.deletedAt),
        ),
      );
    if (rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase()))
      throw new AppError('form_template.name_taken', 'A form with that name already exists.');
  }

  async function createTemplate(scope: TenantScope, projectId: string, input: TemplateInput) {
    requireStaff(scope);
    await deps.platform.getProject(scope, projectId);
    const { fields, name } = checkInput(input);
    await nameFree(scope, projectId, name, 1);
    const id = uuidv7();
    const at = now();
    await scope.tx.insert(templates).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      name,
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      version: 1,
      status: 'draft',
      fields,
      createdAt: at,
      updatedAt: at,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return loadTemplate(scope, projectId, id);
  }

  async function updateTemplate(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: TemplateInput,
  ) {
    requireStaff(scope);
    const t = await loadTemplate(scope, projectId, id);
    if (t.status !== 'draft')
      throw new AppError(
        'form_template.invalid_state',
        'A published form is frozen. Start a new version to change it.',
      );
    const { fields, name } = checkInput(input);
    await nameFree(scope, projectId, name, t.version, id);
    await scope.tx
      .update(templates)
      .set({
        name,
        description: input.description?.trim() || null,
        category: input.category?.trim() || null,
        fields,
        updatedAt: now(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(templates.id, id));
    return loadTemplate(scope, projectId, id);
  }

  /** Publishing freezes the form and retires earlier versions of the same name so only the latest can be assigned. */
  async function publishTemplate(scope: TenantScope, projectId: string, id: string) {
    requireStaff(scope);
    const t = await loadTemplate(scope, projectId, id);
    if (t.status !== 'draft')
      throw new AppError('form_template.invalid_state', 'Only a draft can be published.');
    if (t.fields.length === 0) throw bad('fields', 'Add at least one field before publishing');
    const siblings = await scope.tx
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.projectId, projectId),
          eq(templates.status, 'published'),
          isNull(templates.deletedAt),
        ),
      );
    const retire = siblings
      .filter((s) => s.name.toLowerCase() === t.name.toLowerCase())
      .map((s) => s.id);
    if (retire.length > 0)
      await scope.tx
        .update(templates)
        .set({ status: 'archived' })
        .where(inArray(templates.id, retire));
    await scope.tx
      .update(templates)
      .set({ status: 'published', updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(eq(templates.id, id));
    return loadTemplate(scope, projectId, id);
  }

  async function archiveTemplate(scope: TenantScope, projectId: string, id: string) {
    requireStaff(scope);
    const t = await loadTemplate(scope, projectId, id);
    if (t.status === 'archived')
      throw new AppError('form_template.invalid_state', 'Already archived.');
    await scope.tx
      .update(templates)
      .set({ status: 'archived', updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(eq(templates.id, id));
    return loadTemplate(scope, projectId, id);
  }

  async function newTemplateVersion(scope: TenantScope, projectId: string, id: string) {
    requireStaff(scope);
    const t = await loadTemplate(scope, projectId, id);
    if (t.status === 'draft')
      throw new AppError('form_template.invalid_state', 'This version is still a draft.');
    const all = await scope.tx
      .select()
      .from(templates)
      .where(and(eq(templates.projectId, projectId), isNull(templates.deletedAt)));
    const family = all.filter((r) => r.name.toLowerCase() === t.name.toLowerCase());
    if (family.some((r) => r.status === 'draft'))
      throw new AppError('form_template.invalid_state', 'A draft version already exists.');
    const copy = uuidv7();
    const at = now();
    await scope.tx.insert(templates).values({
      id: copy,
      orgId: scope.ctx.orgId,
      projectId,
      name: t.name,
      description: t.description,
      category: t.category,
      version: Math.max(...family.map((r) => r.version)) + 1,
      status: 'draft',
      fields: t.fields,
      createdAt: at,
      updatedAt: at,
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    return loadTemplate(scope, projectId, copy);
  }

  // ---- submissions ----

  async function loadSubmission(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(submissions)
      .where(and(eq(submissions.id, id), eq(submissions.projectId, projectId)))
      .limit(1);
    // Outside users see only forms made for them; anything else is plain not-found.
    if (!row || (!isStaff(scope) && row.assigneeId !== scope.ctx.userId))
      throw new AppError('form_submission.not_found');
    return row;
  }

  async function view(
    scope: TenantScope,
    projectId: string,
    row: SubmissionRow,
    tpl: TemplateRow,
    day: LocalDate,
  ): Promise<SubmissionView> {
    const staff = isStaff(scope) && (await can(scope, 'forms.submissions.assign', projectId));
    const open = row.status === 'assigned' || row.status === 'in_progress';
    return {
      row,
      template: tpl,
      flags: flagsFor({
        status: row.status,
        dueDate: row.dueDate,
        today: day,
        updatedAt: row.updatedAt,
        now: now(),
      }),
      daysLate: row.dueDate && open ? daysLate(row.dueDate, day) : 0,
      missing: missingRequired(tpl.fields, row.answers),
      canFill: open && (staff || row.assigneeId === scope.ctx.userId),
      canClose:
        row.status === 'submitted' && (await can(scope, 'forms.submissions.close', projectId)),
    };
  }

  async function detail(scope: TenantScope, projectId: string, id: string) {
    const row = await loadSubmission(scope, projectId, id);
    const tpl = await loadTemplate(scope, projectId, row.templateId);
    return view(scope, projectId, row, tpl, await today(scope, projectId));
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    f: {
      status?: SubmissionStatus;
      templateId?: string;
      assigneeId?: string;
      mine?: boolean;
      flagged?: boolean;
      limit: number;
      cursor?: string;
    },
  ) {
    const day = await today(scope, projectId);
    const where: SQL[] = [eq(submissions.projectId, projectId)];
    if (!isStaff(scope)) where.push(eq(submissions.assigneeId, scope.ctx.userId));
    if (f.status) where.push(eq(submissions.status, f.status));
    if (f.templateId) where.push(eq(submissions.templateId, f.templateId));
    if (f.assigneeId) where.push(eq(submissions.assigneeId, f.assigneeId));
    if (f.mine) where.push(eq(submissions.assigneeId, scope.ctx.userId));
    const after = decodeCursor<{ n: number }>(f.cursor);
    if (after) where.push(lt(submissions.number, after.n));
    const rows = await scope.tx
      .select()
      .from(submissions)
      .where(and(...where))
      .orderBy(desc(submissions.number))
      // Flagged is computed from dates, so it filters after the read; over-read to keep pages full enough.
      .limit(f.flagged ? 500 : f.limit + 1);
    const tpls = new Map<string, TemplateRow>();
    const ids = [...new Set(rows.map((r) => r.templateId))];
    if (ids.length > 0)
      for (const t of await scope.tx.select().from(templates).where(inArray(templates.id, ids)))
        tpls.set(t.id, t);
    const views = await Promise.all(
      rows.map((r) => view(scope, projectId, r, tpls.get(r.templateId)!, day)),
    );
    const kept = f.flagged ? views.filter((v) => v.flags.length > 0) : views;
    const page = toPage(kept, f.limit, (v) => ({ n: v.row.number }));
    return page;
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    input: {
      templateId: string;
      title?: string;
      assigneeId?: string | null;
      dueDate?: string | null;
      relatedType?: 'incident' | null;
      relatedId?: string | null;
    },
  ) {
    if (!(await can(scope, 'forms.submissions.assign', projectId)) && input.assigneeId)
      if (input.assigneeId !== scope.ctx.userId)
        throw new AppError('access.denied', "You can't assign forms on this project.");
    if (!isStaff(scope))
      throw new AppError('access.denied', 'Forms are started by the project team.');
    const tpl = await loadTemplate(scope, projectId, input.templateId);
    if (tpl.status !== 'published')
      throw new AppError('form_template.invalid_state', 'Only a published form can be filled in.');
    const assignee = input.assigneeId ?? scope.ctx.userId;
    if (!(await deps.platform.getProjectMembership(scope, projectId, assignee)))
      throw bad('assigneeId', 'Not a member of this project');
    if (input.dueDate) {
      const day = await today(scope, projectId);
      if (input.dueDate < day) throw bad('dueDate', 'The due date has already passed');
    }
    if (input.relatedType === 'incident') {
      if (!input.relatedId || !deps.incidents) throw bad('relatedId', 'Choose an incident');
      // `facts` throws incident.not_found when the incident is missing or not visible to this person.
      await deps.incidents.facts(scope, projectId, input.relatedId);
    }
    const id = uuidv7();
    const at = now();
    const number = await nextNumber(scope, projectId, 'form_submission');
    const title = (input.title?.trim() || `${tpl.name} ${numberLabel(number)}`).slice(0, 200);
    await scope.tx.insert(submissions).values({
      id,
      orgId: scope.ctx.orgId,
      projectId,
      templateId: tpl.id,
      templateVersion: tpl.version,
      number,
      title,
      status: 'assigned',
      assigneeId: assignee,
      dueDate: input.dueDate ?? null,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedType ? (input.relatedId ?? null) : null,
      createdAt: at,
      createdBy: scope.ctx.userId,
      updatedAt: at,
    });
    if (assignee !== scope.ctx.userId)
      await createNotifications(scope, [
        {
          userId: assignee,
          projectId,
          kind: 'forms.assigned',
          entityType: 'form_submission',
          entityId: id,
          title: `Form assigned to you: ${title}`,
          ...(input.dueDate ? { body: `Due ${input.dueDate}` } : {}),
          dedupeKey: `forms.assigned:${id}`,
        },
      ]);
    scope.events.add({
      type: 'forms.submission.created.v1',
      projectId,
      entityType: 'form_submission',
      entityId: id,
      entityVersion: 1,
      data: { templateId: tpl.id },
    });
    return detail(scope, projectId, id);
  }

  async function fillable(scope: TenantScope, projectId: string, id: string) {
    const row = await loadSubmission(scope, projectId, id);
    const staff = isStaff(scope) && (await can(scope, 'forms.submissions.assign', projectId));
    if (!staff && row.assigneeId !== scope.ctx.userId)
      throw new AppError('access.denied', 'This form is assigned to someone else.');
    return row;
  }

  async function checkFiles(scope: TenantScope, projectId: string, fileIds: readonly string[]) {
    for (const [i, fileId] of fileIds.entries()) {
      const f = await deps.files.getFile(scope, fileId);
      if (f.projectId !== projectId || f.status !== 'ready')
        throw new AppError('file.not_in_project', 'Attach files uploaded to this project.', [
          { path: `fileIds/${i}`, message: 'Not a ready file in this project' },
        ]);
    }
  }

  /** Merges `answers` into the saved ones (`null` clears a field) and replaces the attachments when given. */
  async function saveAnswers(
    scope: TenantScope,
    projectId: string,
    id: string,
    input: { answers?: Record<string, AnswerValue | null>; fileIds?: string[] },
  ) {
    const row = await fillable(scope, projectId, id);
    if (!canMove(row.status, 'in_progress') || row.status === 'submitted')
      throw new AppError('form_submission.invalid_transition', 'This form is no longer open.');
    const tpl = await loadTemplate(scope, projectId, row.templateId);
    const byId = new Map(tpl.fields.map((f) => [f.id, f]));
    const next: Answers = { ...row.answers };
    for (const [fid, value] of Object.entries(input.answers ?? {})) {
      const field = byId.get(fid);
      if (!field) throw bad(`answers/${fid}`, 'Not a field on this form');
      if (value === null) {
        delete next[fid];
        continue;
      }
      const problem = answerProblem(field, value);
      if (problem) throw bad(`answers/${fid}`, problem);
      next[fid] = value;
    }
    const fileIds = input.fileIds ? [...new Set(input.fileIds)] : row.fileIds;
    if (fileIds.length > 50) throw bad('fileIds', 'At most 50 attachments');
    if (input.fileIds) await checkFiles(scope, projectId, fileIds);
    await scope.tx
      .update(submissions)
      .set({
        answers: next,
        fileIds,
        status: 'in_progress',
        updatedAt: now(),
        version: row.version + 1,
      })
      .where(eq(submissions.id, id));
    return detail(scope, projectId, id);
  }

  async function submit(scope: TenantScope, projectId: string, id: string) {
    const row = await fillable(scope, projectId, id);
    if (!canMove(row.status, 'submitted') || row.status === 'submitted')
      throw new AppError('form_submission.invalid_transition', 'This form is no longer open.');
    const tpl = await loadTemplate(scope, projectId, row.templateId);
    const missing = missingRequired(tpl.fields, row.answers);
    if (missing.length > 0)
      throw new AppError(
        'validation_failed',
        'Answer the required fields before submitting.',
        missing.map((m) => ({ path: `answers/${m}`, message: 'Required' })),
      );
    const at = now();
    await scope.tx
      .update(submissions)
      .set({
        status: 'submitted',
        submittedAt: at,
        submittedBy: scope.ctx.userId,
        updatedAt: at,
        version: row.version + 1,
      })
      .where(eq(submissions.id, id));
    if (row.createdBy !== scope.ctx.userId)
      await createNotifications(scope, [
        {
          userId: row.createdBy,
          projectId,
          kind: 'forms.submitted',
          entityType: 'form_submission',
          entityId: id,
          title: `Form submitted: ${row.title}`,
          dedupeKey: `forms.submitted:${id}:${row.version + 1}`,
        },
      ]);
    scope.events.add({
      type: 'forms.submission.submitted.v1',
      projectId,
      entityType: 'form_submission',
      entityId: id,
      entityVersion: row.version + 1,
      data: { templateId: row.templateId },
    });
    return detail(scope, projectId, id);
  }

  /** The reviewer sends a submitted form back to be changed, or closes it. */
  async function review(
    scope: TenantScope,
    projectId: string,
    id: string,
    to: 'in_progress' | 'closed',
  ) {
    const row = await loadSubmission(scope, projectId, id);
    if (!isStaff(scope) || !(await can(scope, 'forms.submissions.close', projectId)))
      throw new AppError('access.denied', "You can't review forms on this project.");
    if (!canMove(row.status, to) || row.status !== 'submitted')
      throw new AppError(
        'form_submission.invalid_transition',
        'Only a submitted form can be reviewed.',
      );
    const at = now();
    await scope.tx
      .update(submissions)
      .set({
        status: to,
        ...(to === 'closed'
          ? { closedAt: at, closedBy: scope.ctx.userId }
          : { submittedAt: null, submittedBy: null }),
        updatedAt: at,
        version: row.version + 1,
      })
      .where(eq(submissions.id, id));
    if (to === 'in_progress' && row.assigneeId && row.assigneeId !== scope.ctx.userId)
      await createNotifications(scope, [
        {
          userId: row.assigneeId,
          projectId,
          kind: 'forms.returned',
          entityType: 'form_submission',
          entityId: id,
          title: `Form sent back to you: ${row.title}`,
          dedupeKey: `forms.returned:${id}:${row.version + 1}`,
        },
      ]);
    return detail(scope, projectId, id);
  }

  /**
   * Nova's offer of answers from the project and any related record. Nothing is saved: the person reads the
   * suggestions and applies the ones they want through `saveAnswers`.
   */
  async function prefill(scope: TenantScope, projectId: string, id: string) {
    const row = await fillable(scope, projectId, id);
    const tpl = await loadTemplate(scope, projectId, row.templateId);
    const project = await deps.platform.getProject(scope, projectId);
    const addr = project.address as Record<string, unknown> | null;
    const facts: Record<string, string> = {
      'project.name': project.name,
      today: localDateOf(now(), project.timezone),
    };
    if (project.number) facts['project.number'] = project.number;
    if (addr) {
      const line = [addr.line1, addr.suburb, addr.state, addr.postcode]
        .filter((p) => typeof p === 'string' && p !== '')
        .join(', ');
      if (line) facts['project.address'] = line;
    }
    if (row.relatedType === 'incident' && row.relatedId && deps.incidents)
      Object.assign(facts, await deps.incidents.facts(scope, projectId, row.relatedId));
    return suggestPrefill(tpl.fields, row.answers, facts);
  }

  return {
    listTemplates,
    templateDetail: loadTemplate,
    createTemplate,
    updateTemplate,
    publishTemplate,
    archiveTemplate,
    newTemplateVersion,
    list,
    detail,
    create,
    saveAnswers,
    submit,
    review,
    prefill,
  };
}

export type FormsService = ReturnType<typeof createFormsService>;
