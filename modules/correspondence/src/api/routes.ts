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
import type { CorrespondenceService, ItemFields } from '../application/correspondence';
import type { RelatedLink } from '../domain/correspondence';
import { toDetail, toEmails, toTemplateDto, toTypeDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const itemId = (p: { correspondenceId: string }) => {
  const id = decodeId('correspondence', p.correspondenceId);
  if (!id) throw new AppError('correspondence.not_found');
  return id;
};
const typeId = (p: { typeId: string }) => {
  const id = decodeId('correspondenceType', p.typeId);
  if (!id) throw new AppError('correspondence_type.not_found');
  return id;
};

interface ItemBody {
  subject?: string;
  body?: string;
  fromCompanyId?: string | null;
  toCompanyIds?: string[];
  responseRequired?: boolean;
  dueDate?: string | null;
  eventDate?: string | null;
  timeBarDays?: number | null;
  fileIds?: string[];
  related?: RelatedLink[];
}

/** Request body → service fields, decoding prefixed ids and keeping "absent" distinct from "null". */
function fields(b: ItemBody): ItemFields {
  const out: ItemFields = {};
  if (b.subject !== undefined) out.subject = b.subject;
  if (b.body !== undefined) out.body = b.body;
  if (b.fromCompanyId !== undefined)
    out.fromCompanyId =
      b.fromCompanyId === null ? null : ref('company', b.fromCompanyId, 'fromCompanyId');
  if (b.toCompanyIds !== undefined)
    out.toCompanyIds = b.toCompanyIds.map((c, i) => ref('company', c, `toCompanyIds/${i}`));
  if (b.responseRequired !== undefined) out.responseRequired = b.responseRequired;
  if (b.dueDate !== undefined) out.dueDate = b.dueDate;
  if (b.eventDate !== undefined) out.eventDate = b.eventDate;
  if (b.timeBarDays !== undefined) out.timeBarDays = b.timeBarDays;
  if (b.fileIds !== undefined)
    out.fileIds = b.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`));
  if (b.related !== undefined) out.related = b.related;
  return out;
}

export function correspondenceRoutes(database: Database, svc: CorrespondenceService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const ok = (status: number, x: Awaited<ReturnType<CorrespondenceService['detail']>>) => ({
    status,
    body: toDetail(x),
    headers: { etag: etag(x.item.version) },
  });
  const typeOk = (status: number, t: Awaited<ReturnType<CorrespondenceService['createType']>>) => ({
    status,
    body: toTypeDto(t),
    headers: { etag: etag(t.version) },
  });

  return defineRoutes({
    listCorrespondenceTemplates: async () => ({
      status: 200,
      body: { data: svc.templates().map(toTemplateDto) },
    }),
    listCorrespondenceTypes: async (input) => {
      const rows = await read(input, (s) =>
        svc.listTypes(s, { includeArchived: input.query.includeArchived === 'true' }),
      );
      return { status: 200, body: { data: rows.map(toTypeDto) } };
    },
    createCorrespondenceType: async (input) =>
      typeOk(
        201,
        await tx(input, (s) => {
          const b = input.body;
          return svc.createType(s, {
            ...(b.templateKey !== undefined ? { templateKey: b.templateKey } : {}),
            ...(b.name !== undefined ? { name: b.name } : {}),
            ...(b.prefix !== undefined ? { prefix: b.prefix } : {}),
            ...(b.description !== undefined ? { description: b.description } : {}),
            ...(b.isEvidential !== undefined ? { isEvidential: b.isEvidential } : {}),
            ...(b.responseRequired !== undefined ? { responseRequired: b.responseRequired } : {}),
            ...(b.responseDays !== undefined ? { responseDays: b.responseDays } : {}),
            ...(b.timeBarDays !== undefined ? { timeBarDays: b.timeBarDays } : {}),
            ...(b.subjectTemplate !== undefined ? { subjectTemplate: b.subjectTemplate } : {}),
            ...(b.bodyTemplate !== undefined ? { bodyTemplate: b.bodyTemplate } : {}),
          });
        }),
      ),
    updateCorrespondenceType: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return typeOk(
        200,
        await tx(input, (s) =>
          svc.updateType(s, typeId(input.params), expected, { ...input.body }),
        ),
      );
    },
    listProjectCorrespondenceTypes: async (input) => {
      const rows = await read(input, (s) => svc.projectTypes(s));
      return { status: 200, body: { data: rows.map(toTypeDto) } };
    },
    listCorrespondence: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          ...(q.status ? { status: q.status } : {}),
          ...(q.typeId ? { typeId: ref('correspondenceType', q.typeId, 'typeId') } : {}),
          ...(q.awaitingResponse === 'true' ? { awaitingResponse: true } : {}),
          ...(q.q ? { q: q.q } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: page.data.map((i) => toDetail({ item: i, responses: [] }).item),
          nextCursor: page.nextCursor,
        },
      };
    },
    createCorrespondence: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          svc.create(s, project(input.params), {
            ...fields(input.body),
            typeId: ref('correspondenceType', input.body.typeId, 'typeId'),
          }),
        ),
      ),
    getCorrespondence: async (input) =>
      ok(200, await read(input, (s) => svc.detail(s, project(input.params), itemId(input.params)))),
    updateCorrespondence: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          svc.update(s, project(input.params), itemId(input.params), expected, fields(input.body)),
        ),
      );
    },
    sendCorrespondence: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) => svc.send(s, project(input.params), itemId(input.params), expected)),
      );
    },
    respondToCorrespondence: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          svc.respond(s, project(input.params), itemId(input.params), {
            body: input.body.body,
            fileIds: (input.body.fileIds ?? []).map((f, i) => ref('file', f, `fileIds/${i}`)),
          }),
        ),
      ),
    closeCorrespondence: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) => svc.close(s, project(input.params), itemId(input.params), expected)),
      );
    },
    listCorrespondenceEmails: async (input) => ({
      status: 200,
      body: toEmails(
        await read(input, (s) => svc.emails(s, project(input.params), itemId(input.params))),
      ),
    }),
    emailCorrespondence: async (input) => ({
      status: 201,
      body: toEmails(
        await tx(input, (s) =>
          svc.emailItem(s, project(input.params), itemId(input.params), {
            userIds: input.body.userIds.map((u, i) => ref('user', u, `userIds/${i}`)),
            message: input.body.message ?? '',
          }),
        ),
      ),
    }),
    voidCorrespondence: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          svc.voidItem(s, project(input.params), itemId(input.params), expected, input.body.reason),
        ),
      );
    },
  });
}
