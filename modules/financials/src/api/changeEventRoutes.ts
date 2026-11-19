import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { ChangeEventRow, ChangeEventsService } from '../application/changeEvents';
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

const toChangeEventDto = (e: ChangeEventRow) => ({
  id: encodeId('changeEvent', e.id),
  number: e.number,
  title: e.title,
  description: e.description,
  reason: e.reason,
  estimate: e.estimate,
  status: e.status,
  closedNote: e.closedNote,
  closedAt: e.closedAt?.toISOString() ?? null,
  createdAt: e.createdAt.toISOString(),
});

export function changeEventRoutes(database: Database, changeEvents: ChangeEventsService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const eventId = (p: { changeEventId: string }) =>
    ref('changeEvent', p.changeEventId, 'changeEventId');

  return defineRoutes({
    listChangeEvents: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) => changeEvents.listChangeEvents(s, project(input.params)))
        ).map(toChangeEventDto),
      },
    }),
    createChangeEvent: async (input) => {
      const b = input.body;
      return {
        status: 201,
        body: toChangeEventDto(
          await tx(input, (s) =>
            changeEvents.createChangeEvent(s, project(input.params), {
              title: b.title,
              reason: b.reason,
              ...(b.description ? { description: b.description } : {}),
              ...(b.estimate !== undefined ? { estimate: money(b.estimate, 'estimate') } : {}),
            }),
          ),
        ),
      };
    },
    getChangeEvent: async (input) => {
      const d = await read(input, (s) =>
        changeEvents.getChangeEvent(s, project(input.params), eventId(input.params)),
      );
      return {
        status: 200,
        body: {
          ...toChangeEventDto(d.event),
          variations: d.variations.map((v) => ({
            id: encodeId('variation', v.id),
            number: v.number,
            title: v.title,
            status: v.status,
            amount: v.amount,
          })),
          commitments: d.commitments.map((c) => ({
            id: encodeId('commitment', c.id),
            number: c.number,
            title: c.title,
            status: c.status,
            total: c.total,
          })),
        },
      };
    },
    updateChangeEvent: async (input) => {
      const b = input.body;
      return {
        status: 200,
        body: toChangeEventDto(
          await tx(input, (s) =>
            changeEvents.updateChangeEvent(s, project(input.params), eventId(input.params), {
              ...(b.title !== undefined ? { title: b.title } : {}),
              ...(b.description !== undefined ? { description: b.description } : {}),
              ...(b.reason !== undefined ? { reason: b.reason } : {}),
              ...(b.estimate !== undefined
                ? { estimate: b.estimate === null ? null : money(b.estimate, 'estimate') }
                : {}),
            }),
          ),
        ),
      };
    },
    closeChangeEvent: async (input) => ({
      status: 200,
      body: toChangeEventDto(
        await tx(input, (s) =>
          changeEvents.closeChangeEvent(
            s,
            project(input.params),
            eventId(input.params),
            input.body.note,
          ),
        ),
      ),
    }),
  });
}
