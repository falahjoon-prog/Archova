import { decodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { LinksService } from '../application/links';
import type { ProgrammeService } from '../application/programme';
import type { RegisterService } from '../application/register';
import type { RegisterFilter } from '../domain/register';

const idOf = (kind: IdKind, value: string, error: string) => {
  const id = decodeId(kind, value);
  if (!id) throw new AppError(error as 'schedule.not_found');
  return id;
};

export function schedulingRoutes(
  database: Database,
  register: RegisterService,
  programme: ProgrammeService,
  links: LinksService,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const proj = (p: { projectId: string }) => idOf('project', p.projectId, 'project.not_found');
  const sched = (p: { scheduleId: string }) => idOf('schedule', p.scheduleId, 'schedule.not_found');

  return defineRoutes({
    listSchedules: async (input) => ({
      status: 200,
      body: await read(input, (s) => programme.list(s, proj(input.params))),
    }),
    createSchedule: async (input) => ({
      status: 201,
      body: await tx(input, (s) => programme.create(s, proj(input.params), input.body)),
    }),
    importSchedule: async (input) => ({
      status: 201,
      body: await tx(input, (s) => programme.importProgramme(s, proj(input.params), input.body)),
    }),
    getSchedule: async (input) => ({
      status: 200,
      body: await read(input, (s) => programme.get(s, proj(input.params), sched(input.params))),
    }),
    deleteSchedule: async (input) => {
      await tx(input, (s) => programme.remove(s, proj(input.params), sched(input.params)));
      return { status: 204 };
    },
    createScheduleActivity: async (input) => ({
      status: 201,
      body: await tx(input, (s) =>
        programme.createActivity(s, proj(input.params), sched(input.params), input.body),
      ),
    }),
    updateScheduleActivity: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        programme.updateActivity(
          s,
          proj(input.params),
          sched(input.params),
          idOf('scheduleActivity', input.params.activityId, 'schedule.activity_not_found'),
          input.body,
        ),
      ),
    }),
    deleteScheduleActivity: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        programme.deleteActivity(
          s,
          proj(input.params),
          sched(input.params),
          idOf('scheduleActivity', input.params.activityId, 'schedule.activity_not_found'),
        ),
      ),
    }),
    setScheduleBaseline: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        programme.setBaseline(s, proj(input.params), sched(input.params)),
      ),
    }),
    clearScheduleBaseline: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        programme.clearBaseline(s, proj(input.params), sched(input.params)),
      ),
    }),
    createScheduleDependency: async (input) => ({
      status: 201,
      body: await tx(input, (s) =>
        programme.createDependency(s, proj(input.params), sched(input.params), input.body),
      ),
    }),
    deleteScheduleDependency: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        programme.deleteDependency(
          s,
          proj(input.params),
          sched(input.params),
          idOf('scheduleDependency', input.params.dependencyId, 'schedule.dependency_not_found'),
        ),
      ),
    }),
    listScheduleLinks: async (input) => ({
      status: 200,
      body: await read(input, (s) => links.list(s, proj(input.params), sched(input.params))),
    }),
    listScheduleLinksForItem: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        links.forItem(s, proj(input.params), input.query.kind, input.query.targetId),
      ),
    }),
    createScheduleLink: async (input) => ({
      status: 201,
      body: await tx(input, (s) =>
        links.create(
          s,
          proj(input.params),
          sched(input.params),
          idOf('scheduleActivity', input.params.activityId, 'schedule.activity_not_found'),
          input.body,
        ),
      ),
    }),
    deleteScheduleLink: async (input) => {
      await tx(input, (s) =>
        links.remove(
          s,
          proj(input.params),
          sched(input.params),
          idOf('scheduleLink', input.params.linkId, 'schedule.item_link_not_found'),
        ),
      );
      return { status: 204 };
    },
    getScheduleLookahead: async (input) => ({
      status: 200,
      body: await read(input, (s) =>
        programme.lookahead(s, proj(input.params), sched(input.params), {
          weeks: input.query?.weeks ?? 3,
          ...(input.query?.from ? { from: input.query.from } : {}),
        }),
      ),
    }),
    getDelayRegister: async (input) => {
      const projectId = decodeId('project', input.params.projectId);
      if (!projectId) throw new AppError('project.not_found');
      const q = input.query ?? {};
      const filter: RegisterFilter = {
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.cause ? { cause: q.cause } : {}),
        ...(q.source ? { source: q.source } : {}),
        ...(q.eotOnly === 'true' ? { eotOnly: true } : {}),
      };
      if (filter.from && filter.to && filter.to < filter.from)
        throw new AppError('validation_failed', '`to` must be on or after `from`.', [
          { path: 'to', message: 'Before from' },
        ]);
      return { status: 200, body: await register.build(requireTenant(input), projectId, filter) };
    },
  });
}
