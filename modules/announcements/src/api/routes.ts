import { decodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { AnnouncementsService } from '../application/announcements';
import { toDetail, toSummary } from './mappers';

const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const announcementId = (p: { announcementId: string }) => {
  const id = decodeId('announcement', p.announcementId);
  if (!id) throw new AppError('announcement.not_found');
  return id;
};
function ids(kind: 'user' | 'company', path: string, list: readonly string[] | undefined) {
  return (list ?? []).map((x) => {
    const id = decodeId(kind, x);
    if (!id)
      throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
    return id;
  });
}

export function announcementsRoutes(
  database: Database,
  svc: AnnouncementsService,
  now: () => Date = () => new Date(),
) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const me = (input: { tenant: TenantContext | null }) => requireTenant(input).userId;

  return defineRoutes({
    listAnnouncements: async (input) => {
      const page = await read(input, (s) =>
        svc.list(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
          unreadOnly: input.query.unread === 'true',
        }),
      );
      return {
        status: 200,
        body: {
          data: page.data.map((v) => toSummary(v, page.names, me(input))),
          nextCursor: page.nextCursor,
          unreadCount: page.unreadCount,
        },
      };
    },
    createAnnouncement: async (input) => {
      const b = input.body;
      const audience =
        b.audience.kind === 'all'
          ? ({ kind: 'all' } as const)
          : ({
              kind: 'group',
              companyIds: ids('company', 'audience.companyIds', b.audience.companyIds),
              userIds: ids('user', 'audience.userIds', b.audience.userIds),
            } as const);
      const d = await tx(input, (s) =>
        svc.create(s, project(input.params), {
          title: b.title,
          body: b.body,
          ...(b.priority ? { priority: b.priority } : {}),
          audience,
          keyUserIds: ids('user', 'keyUserIds', b.keyUserIds),
          readByHours: b.readByHours ?? null,
        }),
      );
      return { status: 201, body: toDetail(d, me(input), now()) };
    },
    getAnnouncement: async (input) => ({
      status: 200,
      body: toDetail(
        await read(input, (s) =>
          svc.detail(s, project(input.params), announcementId(input.params)),
        ),
        me(input),
        now(),
      ),
    }),
    markAnnouncementRead: async (input) => ({
      status: 200,
      body: toDetail(
        await tx(input, (s) =>
          svc.markRead(s, project(input.params), announcementId(input.params)),
        ),
        me(input),
        now(),
      ),
    }),
    nudgeAnnouncement: async (input) => ({
      status: 200,
      body: await tx(input, (s) =>
        svc.nudge(
          s,
          project(input.params),
          announcementId(input.params),
          ids('user', 'userIds', input.body.userIds),
        ),
      ),
    }),
  });
}
