import { decodeId, defectLabel, encodeId, warrantyLabel } from '@archova/domain';
import type { WarrantyClaim, WarrantyItem, WarrantyItemDetail } from '@archova/contracts';
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
import type {
  WarrantyClaimView,
  WarrantyFields,
  WarrantyItemView,
  WarrantyService,
} from '../application/warranty';

const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);

export const toWarrantyItem = (r: WarrantyItemView): WarrantyItem => ({
  id: encodeId('warrantyItem', r.id),
  projectId: encodeId('project', r.projectId),
  number: r.number,
  numberLabel: warrantyLabel(r.number),
  name: r.name,
  system: r.system,
  description: r.description,
  responsibleType: r.responsibleType,
  responsibleCompanyId: companyOrNull(r.responsibleCompanyId),
  responsibleName: r.responsibleName,
  startDate: r.startDate,
  durationMonths: r.durationMonths,
  expiryDate: r.expiryDate,
  state: r.state,
  daysToExpiry: r.daysToExpiry,
  claimCount: r.claimCount,
  openClaimCount: r.openClaimCount,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

export const toWarrantyClaim = (c: WarrantyClaimView): WarrantyClaim => ({
  defectId: encodeId('defect', c.defectId),
  numberLabel: defectLabel(c.number),
  title: c.title,
  status: c.status,
  priority: c.priority,
  trade: c.trade,
  warrantyItemId: c.warrantyItemId ? encodeId('warrantyItem', c.warrantyItemId) : null,
  assigneeCompanyId: companyOrNull(c.assigneeCompanyId),
  raisedAt: c.raisedAt.toISOString(),
  closedAt: c.closedAt ? c.closedAt.toISOString() : null,
  daysOpen: c.daysOpen,
  isOverdue: c.isOverdue,
});

const toDetail = (x: {
  item: WarrantyItemView;
  claims: WarrantyClaimView[];
}): WarrantyItemDetail => ({ item: toWarrantyItem(x.item), claims: x.claims.map(toWarrantyClaim) });

const invalid = (path: string) =>
  new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const itemId = (p: { itemId: string }) => {
  const id = decodeId('warrantyItem', p.itemId);
  if (!id) throw new AppError('warranty.not_found');
  return id;
};

type FieldsBody = Omit<WarrantyFields, 'responsibleCompanyId'> & {
  responsibleCompanyId?: string | null;
};
function fields(b: FieldsBody): WarrantyFields {
  const { responsibleCompanyId, ...rest } = b;
  const out: WarrantyFields = { ...rest };
  if (responsibleCompanyId !== undefined) {
    const id = responsibleCompanyId === null ? null : decodeId('company', responsibleCompanyId);
    if (responsibleCompanyId !== null && !id) throw invalid('responsibleCompanyId');
    out.responsibleCompanyId = id;
  }
  return out;
}

export function warrantyRoutes(database: Database, warranty: WarrantyService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const ok = (status: number, x: Awaited<ReturnType<WarrantyService['detail']>>) => ({
    status,
    body: toDetail(x),
    headers: { etag: etag(x.item.version) },
  });

  return defineRoutes({
    listWarrantyItems: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            warranty.list(s, project(input.params), {
              ...(input.query.state ? { state: input.query.state } : {}),
              ...(input.query.system ? { system: input.query.system } : {}),
            }),
          )
        ).map(toWarrantyItem),
      },
    }),
    createWarrantyItem: async (input) =>
      ok(
        201,
        await tx(input, (s) =>
          warranty.create(s, project(input.params), {
            ...fields(input.body),
            name: input.body.name,
            system: input.body.system,
            responsibleType: input.body.responsibleType,
            startDate: input.body.startDate,
            durationMonths: input.body.durationMonths,
          }),
        ),
      ),
    getWarrantyItem: async (input) =>
      ok(
        200,
        await read(input, (s) => warranty.detail(s, project(input.params), itemId(input.params))),
      ),
    updateWarrantyItem: async (input) => {
      const expected = parseIfMatch(input.headers['if-match']);
      return ok(
        200,
        await tx(input, (s) =>
          warranty.update(
            s,
            project(input.params),
            itemId(input.params),
            expected,
            fields(input.body),
          ),
        ),
      );
    },
    deleteWarrantyItem: async (input) => {
      await tx(input, (s) => warranty.remove(s, project(input.params), itemId(input.params)));
      return { status: 204 };
    },
    listWarrantyClaims: async (input) => {
      const item = input.query.warrantyItemId
        ? decodeId('warrantyItem', input.query.warrantyItemId)
        : null;
      if (input.query.warrantyItemId && !item) throw invalid('warrantyItemId');
      const rows = await read(input, (s) =>
        warranty.claims(s, project(input.params), item ? { warrantyItemId: item } : {}),
      );
      return { status: 200, body: { data: rows.map(toWarrantyClaim) } };
    },
    getWarrantySummary: async (input) => {
      const x = await read(input, (s) => warranty.summary(s, project(input.params)));
      return {
        status: 200,
        body: {
          ...x,
          flags: x.flags.map((f) => ({
            ...f,
            itemId: f.itemId ? encodeId('warrantyItem', f.itemId) : null,
            claimId: f.claimId ? encodeId('defect', f.claimId) : null,
          })),
        },
      };
    },
  });
}
