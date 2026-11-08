import type { ProblemCode } from '@archova/contracts';
import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantScope,
} from '@archova/kernel';
import type { PlantService } from '../application/plant';
import { toAllocationDto, toAssetDto, toFlagDto, toPlanDto, toRecordDto } from './mappers';

const id = (kind: IdKind, value: string, notFound: ProblemCode) => {
  const uuid = decodeId(kind, value);
  if (!uuid) throw new AppError(notFound);
  return uuid;
};
/** An id in a request body: a bad one is a validation problem, not a missing record. */
const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};

export function plantRoutes(database: Database, svc: PlantService) {
  const tx = <T>(input: Parameters<typeof requireTenant>[0], fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(
    input: Parameters<typeof requireTenant>[0],
    fn: (s: TenantScope) => Promise<T>,
  ) => database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  const assetId = (p: { assetId: string }) => id('plantAsset', p.assetId, 'plant.asset_not_found');
  const allocationId = (p: { allocationId: string }) =>
    id('plantAllocation', p.allocationId, 'plant.allocation_not_found');
  const planId = (p: { planId: string }) => id('plantPlan', p.planId, 'plant.plan_not_found');

  return defineRoutes({
    listPlantAssets: async (input) => ({
      status: 200,
      body: { data: (await read(input, (s) => svc.listAssets(s))).map(toAssetDto) },
    }),
    createPlantAsset: async (input) => ({
      status: 201,
      body: toAssetDto(await tx(input, (s) => svc.createAsset(s, input.body))),
    }),
    updatePlantAsset: async (input) => ({
      status: 200,
      body: toAssetDto(
        await tx(input, (s) => svc.updateAsset(s, assetId(input.params), input.body)),
      ),
    }),
    listPlantAllocations: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            svc.listAllocations(s, {
              ...(input.query.from ? { from: input.query.from } : {}),
              ...(input.query.to ? { to: input.query.to } : {}),
              ...(input.query.assetId
                ? { assetId: ref('plantAsset', input.query.assetId, 'assetId') }
                : {}),
              ...(input.query.projectId
                ? { projectId: ref('project', input.query.projectId, 'projectId') }
                : {}),
            }),
          )
        ).map(toAllocationDto),
      },
    }),
    createPlantAllocation: async (input) => ({
      status: 201,
      body: toAllocationDto(
        await tx(input, (s) =>
          svc.allocate(s, assetId(input.params), {
            projectId: ref('project', input.body.projectId, 'projectId'),
            startsOn: input.body.startsOn,
            endsOn: input.body.endsOn,
            costCodeId: input.body.costCodeId
              ? ref('costCode', input.body.costCodeId, 'costCodeId')
              : undefined,
            note: input.body.note,
          }),
        ),
      ),
    }),
    cancelPlantAllocation: async (input) => ({
      status: 200,
      body: toAllocationDto(
        await tx(input, (s) => svc.cancelAllocation(s, allocationId(input.params))),
      ),
    }),
    listPlantMaintenancePlans: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            svc.listPlans(s, {
              ...(input.query.assetId
                ? { assetId: ref('plantAsset', input.query.assetId, 'assetId') }
                : {}),
            }),
          )
        ).map(toPlanDto),
      },
    }),
    createPlantMaintenancePlan: async (input) => ({
      status: 201,
      body: toPlanDto(await tx(input, (s) => svc.createPlan(s, assetId(input.params), input.body))),
    }),
    completePlantMaintenancePlan: async (input) => ({
      status: 200,
      body: toPlanDto(
        await tx(input, (s) => svc.completePlan(s, planId(input.params), input.body)),
      ),
    }),
    listPlantMaintenanceRecords: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => svc.records(s, assetId(input.params)))).map(toRecordDto),
      },
    }),
    getPlantUtilisation: async (input) => {
      const u = await read(input, (s) =>
        svc.utilisation(s, {
          startsOn: input.query.from ?? svc.today(),
          endsOn: input.query.to ?? svc.today(),
        }),
      );
      return {
        status: 200,
        body: {
          from: u.window.startsOn,
          to: u.window.endsOn,
          days: u.days,
          fleetPct: u.fleetPct,
          assets: u.assets.map((a) => ({
            assetId: toAssetDto(a.asset).id,
            bookedDays: a.bookedDays,
            idleDays: a.idleDays,
            pct: a.pct,
            costCents: a.costCents,
            idleCostCents: a.idleCostCents,
          })),
          projects: u.projects.map((p) => ({
            projectId: encodeId('project', p.projectId),
            bookedDays: p.bookedDays,
            costCents: p.costCents,
          })),
        },
      };
    },
    listPlantFlags: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => svc.flags(s, { idleDays: input.query.idleDays }))).map(
          toFlagDto,
        ),
      },
    }),
  });
}
