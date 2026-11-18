import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { FormsService } from '../application/forms';
import { toAttention, toFormDetail, toSummary, toTemplate } from './mappers';

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const formId = (p: { formId: string }) => {
  const id = decodeId('form', p.formId);
  if (!id) throw new AppError('form.not_found');
  return id;
};

export function formsRoutes(database: Database, svc: FormsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const detailOk = (status: number, d: Awaited<ReturnType<FormsService['detail']>>) => ({
    status,
    body: toFormDetail(d),
    headers: { etag: etag(d.row.version) },
  });

  return defineRoutes({
    listFormTemplates: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => svc.listTemplates(s, { includeArchived: false }))).map(
          toTemplate,
        ),
      },
    }),
    listOrgFormTemplates: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => svc.listTemplates(s, { includeArchived: true }))).map(
          toTemplate,
        ),
      },
    }),
    createFormTemplate: async (input) => {
      const t = await tx(input, (s) => svc.createTemplate(s, input.body));
      return { status: 201, body: toTemplate(t), headers: { etag: etag(t.version) } };
    },
    updateFormTemplate: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const t = await tx(input, (s) =>
        svc.updateTemplate(s, input.params.templateId, expected, input.body),
      );
      return { status: 200, body: toTemplate(t), headers: { etag: etag(t.version) } };
    },
    listForms: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          ...(q.templateId ? { templateId: q.templateId } : {}),
          ...(q.status ? { status: q.status } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: page.data.map((r) => toSummary(r, page.names, page.counts.get(r.id) ?? 0)),
          nextCursor: page.nextCursor,
        },
      };
    },
    startForm: async (input) =>
      detailOk(201, await tx(input, (s) => svc.start(s, project(input.params), input.body))),
    listFormAttention: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => svc.attention(s, project(input.params)))).map(toAttention),
      },
    }),
    getForm: async (input) =>
      detailOk(
        200,
        await read(input, (s) => svc.detail(s, project(input.params), formId(input.params))),
      ),
    saveForm: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return detailOk(
        200,
        await tx(input, (s) =>
          svc.save(s, project(input.params), formId(input.params), expected, input.body),
        ),
      );
    },
    signForm: async (input) =>
      detailOk(
        201,
        await tx(input, (s) =>
          svc.sign(s, project(input.params), formId(input.params), input.body),
        ),
      ),
    submitForm: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return detailOk(
        200,
        await tx(input, (s) =>
          svc.submit(s, project(input.params), formId(input.params), expected),
        ),
      );
    },
  });
}
