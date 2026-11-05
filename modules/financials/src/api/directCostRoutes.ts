import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { DirectCostRow, DirectCostsService } from '../application/directCosts';
import { isMoney } from '../domain/money';

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
const money = (value: string, path: string) => {
  if (!isMoney(value))
    throw new AppError('validation_failed', 'Invalid amount', [
      { path, message: 'Invalid amount' },
    ]);
  return value;
};

const toDirectCostDto = (c: DirectCostRow) => ({
  id: encodeId('directCost', c.id),
  number: c.number,
  budgetLineId: encodeId('budgetLine', c.budgetLineId),
  category: c.category,
  description: c.description,
  supplier: c.supplier,
  reference: c.reference,
  incurredOn: c.incurredOn,
  amount: c.amount,
  gst: c.gst,
  status: c.status,
  voidReason: c.voidReason,
  voidedAt: c.voidedAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
});

export function directCostRoutes(database: Database, directCosts: DirectCostsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  return defineRoutes({
    listDirectCosts: async (input) => {
      const r = await read(input, (s) => directCosts.listDirectCosts(s, project(input.params)));
      return { status: 200, body: { data: r.rows.map(toDirectCostDto), total: r.total } };
    },
    recordDirectCost: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: toDirectCostDto(
          await tx(input, (s) =>
            directCosts.recordDirectCost(s, project(input.params), {
              budgetLineId: ref('budgetLine', b.budgetLineId, 'budgetLineId'),
              category: b.category,
              description: b.description,
              ...(b.supplier ? { supplier: b.supplier } : {}),
              ...(b.reference ? { reference: b.reference } : {}),
              incurredOn: b.incurredOn,
              amount: money(b.amount, 'amount'),
              ...(b.gst !== undefined ? { gst: money(b.gst, 'gst') } : {}),
            }),
          ),
        ),
      };
    },
    getDirectCost: async (input) => ({
      status: 200,
      body: toDirectCostDto(
        await read(input, (s) =>
          directCosts.getDirectCost(
            s,
            project(input.params),
            ref('directCost', input.params.directCostId, 'directCostId'),
          ),
        ),
      ),
    }),
    voidDirectCost: async (input) => ({
      status: 200,
      body: toDirectCostDto(
        await tx(input, (s) =>
          directCosts.voidDirectCost(
            s,
            project(input.params),
            ref('directCost', input.params.directCostId, 'directCostId'),
            input.body.note,
          ),
        ),
      ),
    }),
  });
}
