import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { FormsService } from '../application/forms';
import type { FieldDef } from '../domain/forms';
import { toSubmissionDetail, toSubmissionDto, toSuggestion, toTemplateDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const notFound = (kind: IdKind, value: string, code: 'form_template.not_found') => {
  const id = decodeId(kind, value);
  if (!id) throw new AppError(code);
  return id;
};
const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};

interface FieldBody {
  id: string;
  section?: string;
  label: string;
  type: FieldDef['type'];
  required?: boolean;
  helpText?: string | null;
  options?: string[];
  prefillKey?: FieldDef['prefillKey'] | null;
}
const fieldsOf = (fields: FieldBody[]): FieldDef[] =>
  fields.map((f) => ({
    id: f.id,
    section: f.section ?? '',
    label: f.label,
    type: f.type,
    required: f.required ?? false,
    helpText: f.helpText ?? null,
    options: f.options ?? [],
    prefillKey: f.prefillKey ?? null,
  }));

export function formsRoutes(database: Database, svc: FormsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const tpl = (p: { templateId: string }) =>
    notFound('formTemplate', p.templateId, 'form_template.not_found');
  const sub = (p: { submissionId: string }) => {
    const id = decodeId('formSubmission', p.submissionId);
    if (!id) throw new AppError('form_submission.not_found');
    return id;
  };

  return defineRoutes({
    listFormTemplates: async (input) => {
      const rows = await read(input, (s) =>
        svc.listTemplates(s, project(input.params), input.query.status),
      );
      return { status: 200, body: { data: rows.map(toTemplateDto) } };
    },
    createFormTemplate: async (input) => ({
      status: 201,
      body: toTemplateDto(
        await tx(input, (s) =>
          svc.createTemplate(s, project(input.params), {
            ...input.body,
            fields: fieldsOf(input.body.fields),
          }),
        ),
      ),
    }),
    getFormTemplate: async (input) => ({
      status: 200,
      body: toTemplateDto(
        await read(input, async (s) => {
          // Templates are the team's to see; `listTemplates` carries the same check for the list.
          if (s.ctx.principalType !== 'member') throw new AppError('form_template.not_found');
          return svc.templateDetail(s, project(input.params), tpl(input.params));
        }),
      ),
    }),
    updateFormTemplate: async (input) => ({
      status: 200,
      body: toTemplateDto(
        await tx(input, (s) =>
          svc.updateTemplate(s, project(input.params), tpl(input.params), {
            ...input.body,
            fields: fieldsOf(input.body.fields),
          }),
        ),
      ),
    }),
    publishFormTemplate: async (input) => ({
      status: 200,
      body: toTemplateDto(
        await tx(input, (s) => svc.publishTemplate(s, project(input.params), tpl(input.params))),
      ),
    }),
    archiveFormTemplate: async (input) => ({
      status: 200,
      body: toTemplateDto(
        await tx(input, (s) => svc.archiveTemplate(s, project(input.params), tpl(input.params))),
      ),
    }),
    newFormTemplateVersion: async (input) => ({
      status: 201,
      body: toTemplateDto(
        await tx(input, (s) => svc.newTemplateVersion(s, project(input.params), tpl(input.params))),
      ),
    }),
    listFormSubmissions: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.templateId ? { templateId: ref('formTemplate', q.templateId, 'templateId') } : {}),
          ...(q.assigneeId ? { assigneeId: ref('user', q.assigneeId, 'assigneeId') } : {}),
          mine: q.mine === 'true',
          flagged: q.flagged === 'true',
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toSubmissionDto), nextCursor: page.nextCursor },
      };
    },
    createFormSubmission: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: toSubmissionDetail(
          await tx(input, (s) =>
            svc.create(s, project(input.params), {
              templateId: ref('formTemplate', b.templateId, 'templateId'),
              ...(b.title !== undefined ? { title: b.title } : {}),
              ...(b.assigneeId ? { assigneeId: ref('user', b.assigneeId, 'assigneeId') } : {}),
              ...(b.dueDate !== undefined ? { dueDate: b.dueDate } : {}),
              ...(b.relatedType ? { relatedType: b.relatedType } : {}),
              ...(b.relatedId ? { relatedId: ref('incident', b.relatedId, 'relatedId') } : {}),
            }),
          ),
        ),
      };
    },
    getFormSubmission: async (input) => ({
      status: 200,
      body: toSubmissionDetail(
        await read(input, (s) => svc.detail(s, project(input.params), sub(input.params))),
      ),
    }),
    saveFormSubmissionAnswers: async (input) => ({
      status: 200,
      body: toSubmissionDetail(
        await tx(input, (s) =>
          svc.saveAnswers(s, project(input.params), sub(input.params), {
            ...(input.body.answers ? { answers: input.body.answers } : {}),
            ...(input.body.fileIds
              ? { fileIds: input.body.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)) }
              : {}),
          }),
        ),
      ),
    }),
    submitFormSubmission: async (input) => ({
      status: 200,
      body: toSubmissionDetail(
        await tx(input, (s) => svc.submit(s, project(input.params), sub(input.params))),
      ),
    }),
    reviewFormSubmission: async (input) => ({
      status: 200,
      body: toSubmissionDetail(
        await tx(input, (s) =>
          svc.review(
            s,
            project(input.params),
            sub(input.params),
            input.body.decision === 'close' ? 'closed' : 'in_progress',
          ),
        ),
      ),
    }),
    suggestFormSubmissionAnswers: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) => svc.prefill(s, project(input.params), sub(input.params)))
        ).map(toSuggestion),
      },
    }),
  });
}
