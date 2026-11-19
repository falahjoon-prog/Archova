import type { ProblemCode } from '@archova/contracts';
import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { PrefabService } from '../application/units';
import { toCheckDto, toEventDto, toFlagDto, toSummaryDto, toUnitDto } from './mappers';

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
const opt = <T>(v: T | undefined, f: (x: T) => string) => (v === undefined ? undefined : f(v));
const project = (p: { projectId: string }) => id('project', p.projectId, 'project.not_found');
const unit = (p: { unitId: string }) => id('prefabUnit', p.unitId, 'prefab_unit.not_found');

/** The ids in a unit body, turned from public ids into uuids. */
const links = (b: { supplierCompanyId?: string; deliveryId?: string }) => ({
  supplierCompanyId: opt(b.supplierCompanyId, (v) => ref('company', v, 'supplierCompanyId')),
  deliveryId: opt(b.deliveryId, (v) => ref('materialDelivery', v, 'deliveryId')),
});

export function prefabRoutes(database: Database, svc: PrefabService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });

  return defineRoutes({
    listPrefabUnits: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            svc.list(s, project(input.params), { status: input.query.status }),
          )
        ).map(toUnitDto),
      },
    }),
    createPrefabUnit: async (input) => ({
      status: 201,
      body: toUnitDto(
        await tx(input, async (s) => {
          const u = await svc.create(s, project(input.params), {
            ...input.body,
            ...links(input.body),
          });
          return (await svc.get(s, project(input.params), u.id)).unit;
        }),
      ),
    }),
    getPrefabUnit: async (input) => {
      const r = await read(input, (s) => svc.get(s, project(input.params), unit(input.params)));
      return {
        status: 200,
        body: {
          unit: toUnitDto(r.unit),
          checks: r.checks.map(toCheckDto),
          events: r.events.map(toEventDto),
        },
      };
    },
    updatePrefabUnit: async (input) => ({
      status: 200,
      body: toUnitDto(
        await tx(input, (s) =>
          svc.update(s, project(input.params), unit(input.params), {
            ...input.body,
            ...links(input.body),
          }),
        ),
      ),
    }),
    transitionPrefabUnit: async (input) => ({
      status: 200,
      body: toUnitDto(
        await tx(input, (s) =>
          svc.transition(s, project(input.params), unit(input.params), input.body),
        ),
      ),
    }),
    draftPrefabDelivery: async (input) => ({
      status: 200,
      body: toUnitDto(
        await tx(input, (s) => svc.draftDelivery(s, project(input.params), unit(input.params))),
      ),
    }),
    addPrefabCheck: async (input) => ({
      status: 201,
      body: toCheckDto(
        await tx(input, (s) =>
          svc.addCheck(s, project(input.params), unit(input.params), input.body),
        ),
      ),
    }),
    recordPrefabCheck: async (input) => ({
      status: 200,
      body: toCheckDto(
        await tx(input, (s) =>
          svc.recordCheck(
            s,
            project(input.params),
            unit(input.params),
            id('prefabCheck', input.params.checkId, 'prefab_check.not_found'),
            {
              ...input.body,
              ...(input.body.fileIds
                ? {
                    fileIds: input.body.fileIds.map((f, i) => ref('file', f, `fileIds/${i}`)),
                  }
                : {}),
            },
          ),
        ),
      ),
    }),
    getPrefabInsights: async (input) => {
      const r = await read(input, (s) => svc.insights(s, project(input.params)));
      return {
        status: 200,
        body: {
          asOf: r.asOf.toISOString(),
          today: r.today,
          summary: toSummaryDto(r.summary),
          flags: r.flags.map(toFlagDto),
        },
      };
    },
    planPrefabDates: async (input) => ({
      status: 200,
      body: await read(input, (s) => svc.plan(s, project(input.params), input.body)),
    }),
  });
}
