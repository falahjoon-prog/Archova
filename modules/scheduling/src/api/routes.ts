import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { EotService } from '../application/eot';
import type { LinksService } from '../application/links';
import type { ProgrammeService } from '../application/programme';
import type { RegisterService } from '../application/register';
import type { RegisterFilter } from '../domain/register';
import { toEventDto, toFlagDto, toItemDto, toLogDto, toSettingsDto } from './eot-mappers';

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
  eot: EotService,
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const proj = (p: { projectId: string }) => idOf('project', p.projectId, 'project.not_found');
  const sched = (p: { scheduleId: string }) => idOf('schedule', p.scheduleId, 'schedule.not_found');
  const evt = (p: { eventId: string }) => idOf('delayEvent', p.eventId, 'delay_event.not_found');
  const detail = async (r: Awaited<ReturnType<EotService['get']>>) => ({
    event: toEventDto(r.event),
    items: r.items.map(toItemDto),
    history: r.history.map(toLogDto),
    settings: toSettingsDto(r.settings),
  });

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
    getEotSettings: async (input) => ({
      status: 200,
      body: toSettingsDto(await read(input, (s) => eot.getSettings(s, proj(input.params)))),
    }),
    putEotSettings: async (input) => ({
      status: 200,
      body: toSettingsDto(
        await tx(input, (s) => eot.putSettings(s, proj(input.params), input.body)),
      ),
    }),
    listDelayEventCandidates: async (input) => {
      const q = input.query ?? {};
      if (q.from && q.to && q.to < q.from)
        throw new AppError('validation_failed', '`to` must be on or after `from`.', [
          { path: 'to', message: 'Before from' },
        ]);
      const r = await read(input, (s) =>
        eot.candidates(s, proj(input.params), {
          from: q.from,
          to: q.to,
          includeAttached: q.includeAttached === 'true',
        }),
      );
      return {
        status: 200,
        body: {
          ...r,
          data: r.data.map((c) => ({
            ...c,
            eventId: c.eventId ? encodeId('delayEvent', c.eventId) : null,
          })),
        },
      };
    },
    getDelayEventInsights: async (input) => {
      const r = await read(input, (s) => eot.insights(s, proj(input.params)));
      return {
        status: 200,
        body: {
          asOf: r.asOf.toISOString(),
          today: r.today,
          flags: r.flags.map(toFlagDto),
          summary: {
            events: r.summary.events,
            open: r.summary.open,
            daysClaimed: r.summary.daysClaimed,
            daysGranted: r.summary.daysGranted,
            awaitingAssessment: r.summary.awaitingAssessment,
            untrackedDelays: r.summary.untrackedDelays,
            wetDays: r.summary.wetDays,
            wetDayAllowance: r.summary.wetDayAllowance,
            periodsConfirmed: r.summary.periodsConfirmed,
          },
        },
      };
    },
    listDelayEvents: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) => eot.list(s, proj(input.params), { status: input.query?.status }))
        ).map(toEventDto),
      },
    }),
    createDelayEvent: async (input) => ({
      status: 201,
      body: toEventDto(await tx(input, (s) => eot.create(s, proj(input.params), input.body))),
    }),
    getDelayEvent: async (input) => ({
      status: 200,
      body: await detail(
        await read(input, (s) => eot.get(s, proj(input.params), evt(input.params))),
      ),
    }),
    updateDelayEvent: async (input) => ({
      status: 200,
      body: toEventDto(
        await tx(input, (s) => eot.update(s, proj(input.params), evt(input.params), input.body)),
      ),
    }),
    addDelayEventEvidence: async (input) => ({
      status: 200,
      body: await detail(
        await tx(input, (s) =>
          eot.addEvidence(s, proj(input.params), evt(input.params), {
            candidateKeys: input.body.candidateKeys,
            correspondenceIds: input.body.correspondenceIds,
            notes: input.body.notes,
          }),
        ),
      ),
    }),
    removeDelayEventEvidence: async (input) => {
      await tx(input, (s) =>
        eot.removeEvidence(
          s,
          proj(input.params),
          evt(input.params),
          idOf('delayEventItem', input.params.itemId, 'delay_event.evidence_not_found'),
        ),
      );
      return { status: 204 };
    },
    transitionDelayEvent: async (input) => ({
      status: 200,
      body: toEventDto(
        await tx(input, (s) =>
          eot.transition(s, proj(input.params), evt(input.params), input.body),
        ),
      ),
    }),
    draftDelayEventLetter: async (input) => {
      const d = await tx(input, (s) =>
        eot.draft(s, proj(input.params), evt(input.params), input.body),
      );
      return {
        status: 200,
        body: {
          eventId: encodeId('delayEvent', d.eventId),
          subject: d.subject,
          body: d.body,
          warnings: d.warnings,
        },
      };
    },
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
