import { decodeId, type IdKind } from '@archova/domain';
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
import type { PrequalService } from '../application/prequalifications';
import type { TemplateService } from '../application/templates';
import { toPrequalDto, toSummaryDto, toTemplateDto } from './mappers';

const notFound = (kind: IdKind, value: string, code: string) => {
  const id = decodeId(kind, value);
  if (!id) throw new AppError(code as 'not_found');
  return id;
};
const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

export function preconRoutes(
  database: Database,
  templates: TemplateService,
  forms: PrequalService,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const templateId = (p: { templateId: string }) =>
    notFound('prequalTemplate', p.templateId, 'prequal_template.not_found');
  const formId = (p: { prequalId: string }) =>
    notFound('prequalification', p.prequalId, 'prequal.not_found');

  const okTemplate = (status: number, r: Parameters<typeof toTemplateDto>[0]) => ({
    status,
    body: toTemplateDto(r),
    headers: { etag: etag(r.rowVersion) },
  });
  const okForm = (status: number, v: Parameters<typeof toPrequalDto>[0]) => ({
    status,
    body: toPrequalDto(v),
    headers: { etag: etag(v.row.version) },
  });

  return defineRoutes({
    listPrequalTemplates: async (input) => {
      const rows = await read(input, (s) => templates.list(s));
      return { status: 200, body: { data: rows.map(toTemplateDto) } };
    },
    createPrequalTemplate: async (input) => {
      const row = await tx(input, (s) => templates.create(s, input.body));
      return okTemplate(201, row);
    },
    getPrequalTemplate: async (input) =>
      okTemplate(200, await read(input, (s) => templates.get(s, templateId(input.params)))),
    updatePrequalTemplate: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      const row = await tx(input, (s) =>
        templates.update(s, templateId(input.params), expected, {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.validityMonths !== undefined ? { validityMonths: b.validityMonths } : {}),
          ...(b.questions ? { questions: b.questions } : {}),
        }),
      );
      return okTemplate(200, row);
    },
    publishPrequalTemplate: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okTemplate(
        200,
        await tx(input, (s) => templates.publish(s, templateId(input.params), expected)),
      );
    },
    newPrequalTemplateVersion: async (input) =>
      okTemplate(201, await tx(input, (s) => templates.newVersion(s, templateId(input.params)))),

    listPrequalifications: async (input) => {
      const q = input.query;
      const rows = await read(input, (s) =>
        forms.list(s, {
          ...(q.companyId ? { companyId: ref('company', q.companyId, 'companyId') } : {}),
          ...(q.status ? { status: q.status } : {}),
        }),
      );
      return { status: 200, body: { data: rows.map(toSummaryDto) } };
    },
    getPrequalificationRegister: async (input) => {
      const q = input.query;
      const rows = await read(input, (s) =>
        forms.register(s, {
          ...(q.state ? { state: q.state } : {}),
          ...(q.trade ? { trade: q.trade } : {}),
        }),
      );
      return { status: 200, body: { data: rows.map(toSummaryDto) } };
    },
    createPrequalification: async (input) => {
      const b = input.body;
      const v = await tx(input, (s) =>
        forms.create(s, {
          companyId: ref('company', b.companyId, 'companyId'),
          templateId: ref('prequalTemplate', b.templateId, 'templateId'),
          ...(b.trades ? { trades: b.trades } : {}),
        }),
      );
      return okForm(201, v);
    },
    getPrequalification: async (input) =>
      okForm(200, await read(input, (s) => forms.get(s, formId(input.params)))),
    updatePrequalification: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      const v = await tx(input, (s) =>
        forms.update(s, formId(input.params), expected, {
          ...(b.answers ? { answers: b.answers } : {}),
          ...(b.trades ? { trades: b.trades } : {}),
        }),
      );
      return okForm(200, v);
    },
    submitPrequalification: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okForm(200, await tx(input, (s) => forms.submit(s, formId(input.params), expected)));
    },
    approvePrequalification: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return okForm(
        200,
        await tx(input, (s) =>
          forms.approve(s, formId(input.params), expected, {
            ...(b.note ? { note: b.note } : {}),
            ...(b.expiresOn ? { expiresOn: b.expiresOn } : {}),
          }),
        ),
      );
    },
    rejectPrequalification: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return okForm(
        200,
        await tx(input, (s) => forms.reject(s, formId(input.params), expected, input.body.note)),
      );
    },
  });
}
