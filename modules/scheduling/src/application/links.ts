import { and, asc, eq, isNull } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7 } from '@archova/domain';
import type { CreateScheduleLinkRequest } from '@archova/contracts';
import { AppError, type TenantScope } from '@archova/kernel';
import { resolveLinks, type LinkKind, type LinkRow, type LinkTarget } from '../domain/links';
import { activities, activityLinks, schedules } from '../infra/tables';

type Source = (
  scope: TenantScope,
  projectId: string,
  ids: readonly string[],
) => Promise<readonly LinkTarget[]>;

export interface LinksDeps {
  rfis: { summariesByIds: Source };
  submittals: { summariesByIds: Source };
}

const KIND_ID = { rfi: 'rfi', submittal: 'submittal' } as const;

export function createLinksService(deps: LinksDeps) {
  const sources: Record<LinkKind, Source> = {
    rfi: (s, p, ids) => deps.rfis.summariesByIds(s, p, ids),
    submittal: (s, p, ids) => deps.submittals.summariesByIds(s, p, ids),
  };

  async function schedule(scope: TenantScope, projectId: string, scheduleId: string) {
    const [row] = await scope.tx
      .select({ id: schedules.id })
      .from(schedules)
      .where(
        and(
          eq(schedules.id, scheduleId),
          eq(schedules.projectId, projectId),
          isNull(schedules.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('schedule.not_found');
  }

  async function dto(scope: TenantScope, projectId: string, rows: readonly LinkRow[]) {
    const found = {
      rfi: new Map<string, LinkTarget>(),
      submittal: new Map<string, LinkTarget>(),
    };
    for (const kind of ['rfi', 'submittal'] as const) {
      const ids = [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.targetId))];
      for (const t of await sources[kind](scope, projectId, ids)) found[kind].set(t.id, t);
    }
    return resolveLinks(rows, found).map((l) => ({
      id: encodeId('scheduleLink', l.row.id),
      activityId: encodeId('scheduleActivity', l.row.activityId),
      kind: l.row.kind,
      targetId: encodeId(KIND_ID[l.row.kind], l.row.targetId),
      visible: l.visible,
      ref: l.ref,
      title: l.title,
      status: l.status,
      dueDate: l.dueDate,
      scheduleImpactDays: l.scheduleImpactDays,
    }));
  }

  async function list(scope: TenantScope, projectId: string, scheduleId: string) {
    await schedule(scope, projectId, scheduleId);
    const rows = await scope.tx
      .select()
      .from(activityLinks)
      .where(eq(activityLinks.scheduleId, scheduleId))
      .orderBy(asc(activityLinks.createdAt), asc(activityLinks.id));
    return { data: await dto(scope, projectId, rows) };
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    scheduleId: string,
    activityId: string,
    input: CreateScheduleLinkRequest,
  ) {
    await schedule(scope, projectId, scheduleId);
    const [activity] = await scope.tx
      .select({ id: activities.id })
      .from(activities)
      .where(and(eq(activities.id, activityId), eq(activities.scheduleId, scheduleId)))
      .limit(1);
    if (!activity) throw new AppError('schedule.activity_not_found');
    const targetId = decodeId(KIND_ID[input.kind], input.targetId);
    if (!targetId)
      throw new AppError('validation_failed', 'Not a valid id.', [
        { path: 'targetId', message: 'Invalid id' },
      ]);
    // Only an item the caller can see may be tied to the programme.
    const [target] = await sources[input.kind](scope, projectId, [targetId]);
    if (!target)
      throw new AppError('validation_failed', 'That item was not found.', [
        { path: 'targetId', message: `Not an ${input.kind} you can see on this project` },
      ]);
    const [dup] = await scope.tx
      .select({ id: activityLinks.id })
      .from(activityLinks)
      .where(
        and(
          eq(activityLinks.activityId, activityId),
          eq(activityLinks.kind, input.kind),
          eq(activityLinks.targetId, targetId),
        ),
      )
      .limit(1);
    if (dup) throw new AppError('schedule.item_link_exists');
    const row: LinkRow & { orgId: string; projectId: string; scheduleId: string } = {
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      scheduleId,
      activityId,
      kind: input.kind,
      targetId,
    };
    await scope.tx.insert(activityLinks).values({ ...row, createdBy: scope.ctx.userId });
    const [out] = await dto(scope, projectId, [row]);
    return out!;
  }

  async function remove(scope: TenantScope, projectId: string, scheduleId: string, linkId: string) {
    await schedule(scope, projectId, scheduleId);
    const gone = await scope.tx
      .delete(activityLinks)
      .where(and(eq(activityLinks.id, linkId), eq(activityLinks.scheduleId, scheduleId)))
      .returning({ id: activityLinks.id });
    if (!gone.length) throw new AppError('schedule.item_link_not_found');
  }

  return { list, create, remove };
}

export type LinksService = ReturnType<typeof createLinksService>;
