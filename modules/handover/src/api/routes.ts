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
import type { HandoverService, ItemFields } from '../application/handover';
import type { HandoverCategory } from '../domain/handover';
import { toExportDto, toFlagDto, toIssueDto, toItemDetail, toPackDto } from './mappers';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

type Body = {
  category?: HandoverCategory;
  title?: string;
  description?: string | null;
  required?: boolean;
  responsibleCompanyId?: string | null;
  dueOn?: string | null;
  note?: string | null;
  fileIds?: string[];
};

function fields(b: Body): ItemFields {
  const out: ItemFields = {};
  if (b.category !== undefined) out.category = b.category;
  if (b.title !== undefined) out.title = b.title;
  if (b.description !== undefined) out.description = b.description;
  if (b.required !== undefined) out.required = b.required;
  if (b.responsibleCompanyId !== undefined)
    out.responsibleCompanyId =
      b.responsibleCompanyId === null
        ? null
        : ref('company', b.responsibleCompanyId, 'responsibleCompanyId');
  if (b.dueOn !== undefined) out.dueOn = b.dueOn;
  if (b.note !== undefined) out.note = b.note;
  if (b.fileIds !== undefined) out.fileIds = b.fileIds.map((f) => ref('file', f, 'fileIds'));
  return out;
}

export function handoverRoutes(database: Database, handover: HandoverService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const project = (p: { projectId: string }) => {
    const id = decodeId('project', p.projectId);
    if (!id) throw new AppError('project.not_found');
    return id;
  };
  const itemId = (p: { handoverItemId: string }) => {
    const id = decodeId('handoverItem', p.handoverItemId);
    if (!id) throw new AppError('handover.item_not_found');
    return id;
  };
  const ok = (status: number, d: Awaited<ReturnType<HandoverService['detail']>>) => ({
    status,
    body: toItemDetail(d),
    headers: { etag: etag(d.item.version) },
  });

  return defineRoutes({
    getHandoverPack: async (input) => ({
      status: 200,
      body: toPackDto(await read(input, (s) => handover.pack(s, project(input.params)))),
    }),
    createHandoverItem: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          handover.create(s, project(input.params), {
            ...fields(input.body),
            category: input.body.category,
            title: input.body.title,
          }),
        ),
      ),
    applyHandoverTemplate: async (input) => ({
      status: 200,
      body: await tx(input, (s) => handover.applyTemplate(s, project(input.params))),
    }),
    getHandoverItem: async (input) =>
      ok(
        200,
        await read(input, (s) => handover.detail(s, project(input.params), itemId(input.params))),
      ),
    updateHandoverItem: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          handover.update(
            s,
            project(input.params),
            itemId(input.params),
            expected,
            fields(input.body),
          ),
        ),
      );
    },
    transitionHandoverItem: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      return ok(
        200,
        await tx(input, (s) =>
          handover.transition(s, project(input.params), itemId(input.params), expected, {
            action: b.action,
            ...(b.note !== undefined ? { note: b.note } : {}),
          }),
        ),
      );
    },
    listHandoverFlags: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => handover.flags(s, project(input.params)))).map(toFlagDto),
      },
    }),
    getHandoverExport: async (input) => ({
      status: 200,
      body: toExportDto(
        await read(input, (s) => handover.exportManifest(s, project(input.params))),
      ),
    }),
    issueHandoverPack: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: toIssueDto(
          await tx(input, (s) =>
            handover.issue(s, project(input.params), {
              recipientName: b.recipientName,
              ...(b.note !== undefined ? { note: b.note } : {}),
              ...(b.acknowledgeIncomplete !== undefined
                ? { acknowledgeIncomplete: b.acknowledgeIncomplete }
                : {}),
            }),
          ),
        ),
      };
    },
  });
}
