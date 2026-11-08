import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { ProductionService } from '../application/production';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

const toItem = (r: {
  id: string;
  name: string;
  uom: string;
  trade: string | null;
  location: string | null;
  plannedQuantity: string;
  plannedStart: string;
  plannedFinish: string;
  archivedAt: Date | null;
}) => ({
  id: encodeId('productionItem', r.id),
  name: r.name,
  uom: r.uom,
  trade: r.trade,
  location: r.location,
  plannedQuantity: Number(r.plannedQuantity),
  plannedStart: r.plannedStart,
  plannedFinish: r.plannedFinish,
  archived: r.archivedAt !== null,
});

const toEntry = (e: {
  id: string;
  loggedOn: string;
  quantity: string;
  crew: string | null;
  note: string | null;
  createdAt: Date;
}) => ({
  id: encodeId('productionEntry', e.id),
  loggedOn: e.loggedOn,
  quantity: Number(e.quantity),
  crew: e.crew,
  note: e.note,
  createdAt: e.createdAt.toISOString(),
});

export function productionRoutes(database: Database, production: ProductionService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const project = (p: { projectId: string }) => {
    const id = decodeId('project', p.projectId);
    if (!id) throw new AppError('project.not_found');
    return id;
  };
  const item = (p: { itemId: string }) => ref('productionItem', p.itemId, 'itemId');

  return defineRoutes({
    getProductionReport: async (input) => {
      const q = input.query ?? {};
      const r = await read(input, (s) =>
        production.report(s, project(input.params), {
          ...(q.trade ? { trade: q.trade } : {}),
          ...(q.location ? { location: q.location } : {}),
          ...(q.includeArchived ? { includeArchived: true } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          asOf: r.asOf,
          items: r.items.map((x) => ({ item: toItem(x.row), ...x.progress })),
          curves: r.curves,
          byTrade: r.byTrade,
          byLocation: r.byLocation,
          flags: r.flags,
        },
      };
    },
    createProductionItem: async (input) => ({
      status: 201,
      body: toItem(
        await tx(input, (s) => production.createItem(s, project(input.params), input.body)),
      ),
    }),
    updateProductionItem: async (input) => ({
      status: 200,
      body: toItem(
        await tx(input, (s) =>
          production.updateItem(s, project(input.params), item(input.params), input.body),
        ),
      ),
    }),
    listProductionEntries: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            production.listEntries(s, project(input.params), item(input.params)),
          )
        ).map(toEntry),
      },
    }),
    logProductionEntry: async (input) => {
      const r = await tx(input, (s) =>
        production.logEntry(s, project(input.params), item(input.params), input.body),
      );
      return {
        status: 201,
        body: { entry: toEntry(r.entry), quantityInstalled: r.quantityInstalled },
      };
    },
  });
}
