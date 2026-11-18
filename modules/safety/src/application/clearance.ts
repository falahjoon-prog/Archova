import { and, eq, isNull, sql } from 'drizzle-orm';
import { localDateOf } from '@archova/time';
import type { TenantScope } from '@archova/kernel';
import { acknowledgements, swms } from '../infra/tables';
import type { SafetyDeps } from './swms';

export interface WorkerSwmsClearance {
  number: number;
  title: string;
  status: 'accepted' | 'awaiting_review' | 'rejected';
  expired: boolean;
  /** Null when the worker has no login to acknowledge with. */
  acknowledged: boolean | null;
}

/**
 * The SWMS a worker's company works under on a project, and whether the worker has read each accepted one at its
 * current revision. For the site clearance check in `workforce`, which has already authorised the caller; this
 * reads one worker's acknowledgements only.
 */
export function createClearanceService(deps: Pick<SafetyDeps, 'platform' | 'now'>) {
  const now = deps.now ?? (() => new Date());

  async function workerSwms(
    scope: TenantScope,
    projectId: string,
    worker: { companyId: string | null; userId: string | null },
  ): Promise<WorkerSwmsClearance[]> {
    if (!worker.companyId) return [];
    const project = await deps.platform.getProject(scope, projectId);
    const today = localDateOf(now(), project.timezone);
    const rows = await scope.tx
      .select({
        id: swms.id,
        number: swms.number,
        title: swms.title,
        status: swms.status,
        revision: swms.revision,
        expired: sql<boolean>`coalesce(${swms.expiresOn} < ${today}::date, false)`,
      })
      .from(swms)
      .where(
        and(
          eq(swms.projectId, projectId),
          eq(swms.companyId, worker.companyId),
          isNull(swms.deletedAt),
        ),
      );
    const acked = new Set<string>();
    if (worker.userId) {
      const mine = await scope.tx
        .select({ swmsId: acknowledgements.swmsId, revision: acknowledgements.revision })
        .from(acknowledgements)
        .where(
          and(
            eq(acknowledgements.projectId, projectId),
            eq(acknowledgements.userId, worker.userId),
          ),
        );
      for (const a of mine) acked.add(`${a.swmsId}:${a.revision}`);
    }
    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      status:
        r.status === 'accepted'
          ? 'accepted'
          : r.status === 'rejected'
            ? 'rejected'
            : 'awaiting_review',
      expired: r.expired,
      acknowledged: worker.userId ? acked.has(`${r.id}:${r.revision}`) : null,
    }));
  }

  return { workerSwms };
}
