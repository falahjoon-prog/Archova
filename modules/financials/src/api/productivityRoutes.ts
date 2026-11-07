import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { ProductivityService } from '../application/productivity';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

export function productivityRoutes(database: Database, productivity: ProductivityService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const project = (p: { projectId: string }) => {
    const id = decodeId('project', p.projectId);
    if (!id) throw new AppError('project.not_found');
    return id;
  };
  const code = (id: string) => encodeId('costCode', id);

  return defineRoutes({
    getLaborProductivity: async (input) => {
      const q = input.query ?? {};
      const r = await read(input, (s) =>
        productivity.report(s, project(input.params), {
          ...(q.divisionId ? { divisionId: ref('costCode', q.divisionId, 'divisionId') } : {}),
          ...(q.subJobId ? { subJobId: ref('costCode', q.subJobId, 'subJobId') } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          rows: r.rows.map((x) => ({
            ...x,
            costCodeId: code(x.costCodeId),
            divisionId: code(x.divisionId),
            parentId: x.parentId ? code(x.parentId) : null,
          })),
          totals: r.totals,
          unallocatedHours: r.unallocatedHours,
          codes: r.codes.map((c) => ({
            id: code(c.id),
            code: c.code,
            description: c.description,
            parentId: c.parentId ? code(c.parentId) : null,
          })),
        },
      };
    },
    setCostCodeProduction: async (input) => ({
      status: 200,
      body: await (async () => {
        const r = await tx(input, (s) =>
          productivity.setProduction(
            s,
            project(input.params),
            ref('costCode', input.params.costCodeId, 'costCodeId'),
            input.body,
          ),
        );
        return { ...r, costCodeId: code(r.costCodeId) };
      })(),
    }),
  });
}
