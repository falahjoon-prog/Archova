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
import type { LogisticsService } from '../application/deliveries';
import { toDeliveryDto, toEventDto, toFlagDto, toResourceDto, toSlotDto } from './mappers';

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
const dlv = (p: { deliveryId: string }) =>
  id('materialDelivery', p.deliveryId, 'logistics_delivery.not_found');
const date = (v: string | undefined) => (v ? new Date(v) : undefined);

/** The ids in a delivery body, turned from public ids into uuids. */
function plan(b: {
  zoneId?: string;
  liftResourceId?: string;
  commitmentId?: string;
  supplierCompanyId?: string;
}) {
  return {
    zoneId: opt(b.zoneId, (v) => ref('logisticsResource', v, 'zoneId')),
    liftResourceId: opt(b.liftResourceId, (v) => ref('logisticsResource', v, 'liftResourceId')),
    commitmentId: opt(b.commitmentId, (v) => ref('commitment', v, 'commitmentId')),
    supplierCompanyId: opt(b.supplierCompanyId, (v) => ref('company', v, 'supplierCompanyId')),
  };
}

export function logisticsRoutes(database: Database, svc: LogisticsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const resId = (p: { resourceId: string }) =>
    id('logisticsResource', p.resourceId, 'logistics_resource.not_found');

  return defineRoutes({
    listLogisticsResources: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => svc.listResources(s, project(input.params)))).map(
          toResourceDto,
        ),
      },
    }),
    createLogisticsResource: async (input) => ({
      status: 201,
      body: toResourceDto(
        await tx(input, (s) => svc.createResource(s, project(input.params), input.body)),
      ),
    }),
    updateLogisticsResource: async (input) => ({
      status: 200,
      body: toResourceDto(
        await tx(input, (s) =>
          svc.updateResource(s, project(input.params), resId(input.params), input.body),
        ),
      ),
    }),
    listDeliveries: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            svc.list(s, project(input.params), {
              from: date(input.query.from),
              to: date(input.query.to),
              status: input.query.status,
            }),
          )
        ).map(toDeliveryDto),
      },
    }),
    createDelivery: async (input) => ({
      status: 201,
      body: toDeliveryDto(
        await tx(input, (s) =>
          svc.create(s, project(input.params), {
            ...input.body,
            ...plan(input.body),
            windowStart: new Date(input.body.windowStart),
            windowEnd: new Date(input.body.windowEnd),
            liftStart: date(input.body.liftStart),
            liftEnd: date(input.body.liftEnd),
          }),
        ),
      ),
    }),
    getDelivery: async (input) => {
      const r = await read(input, (s) => svc.get(s, project(input.params), dlv(input.params)));
      return {
        status: 200,
        body: { delivery: toDeliveryDto(r.delivery), events: r.events.map(toEventDto) },
      };
    },
    updateDelivery: async (input) => ({
      status: 200,
      body: toDeliveryDto(
        await tx(input, (s) =>
          svc.update(s, project(input.params), dlv(input.params), {
            ...input.body,
            ...plan(input.body),
            liftStart: date(input.body.liftStart),
            liftEnd: date(input.body.liftEnd),
          }),
        ),
      ),
    }),
    checkInDelivery: async (input) => ({
      status: 200,
      body: toDeliveryDto(
        await tx(input, (s) =>
          svc.checkIn(s, project(input.params), dlv(input.params), {
            event: input.body.event,
            at: date(input.body.at),
            note: input.body.note,
          }),
        ),
      ),
    }),
    changeDelivery: async (input) => ({
      status: 200,
      body: toDeliveryDto(
        await tx(input, (s) =>
          svc.change(s, project(input.params), dlv(input.params), {
            action: input.body.action,
            reason: input.body.reason,
            windowStart: date(input.body.windowStart),
            windowEnd: date(input.body.windowEnd),
            zoneId: opt(input.body.zoneId, (v) => ref('logisticsResource', v, 'zoneId')),
            liftResourceId: opt(input.body.liftResourceId, (v) =>
              ref('logisticsResource', v, 'liftResourceId'),
            ),
          }),
        ),
      ),
    }),
    draftDeliveryNotice: async (input) => {
      const n = await tx(input, (s) =>
        svc.notice(s, project(input.params), dlv(input.params), input.body),
      );
      return {
        status: 200,
        body: {
          to: n.to,
          subject: n.subject,
          body: n.body,
          proposed: n.proposed ? { ...toSlotDto(n.proposed), zoneName: n.proposed.zoneName } : null,
        },
      };
    },
    getDeliveryInsights: async (input) => {
      const r = await read(input, (s) => svc.insights(s, project(input.params)));
      return {
        status: 200,
        body: {
          asOf: r.asOf.toISOString(),
          today: r.today,
          counts: r.counts,
          flags: r.flags.map(toFlagDto),
        },
      };
    },
    suggestDeliverySlots: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            svc.suggest(s, project(input.params), {
              ...input.body,
              zoneId: opt(input.body.zoneId, (v) => ref('logisticsResource', v, 'zoneId')),
              liftResourceId: opt(input.body.liftResourceId, (v) =>
                ref('logisticsResource', v, 'liftResourceId'),
              ),
              ignoreDeliveryId: opt(input.body.ignoreDeliveryId, (v) =>
                ref('materialDelivery', v, 'ignoreDeliveryId'),
              ),
            }),
          )
        ).map(toSlotDto),
      },
    }),
  });
}
