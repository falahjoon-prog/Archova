import { decodeId } from '@archova/domain';
import { AppError, defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { DrainService } from '../application/drain';
import type { PullService } from '../application/pull';
import type { PushService } from '../application/push';
import type { ReviewService } from '../application/review';
import { parseScopes } from '../domain/scopes';

export function syncRoutes(
  database: Database,
  pull: PullService,
  push: PushService,
  review: ReviewService,
  drain: DrainService,
) {
  /** Link sessions never review; the project and the held change come from the path. */
  function reviewer(input: {
    tenant: unknown;
    params: { projectId: string; lateSubmissionId?: string };
  }) {
    const tenant = requireTenant(input as never);
    if (tenant.actor) throw new AppError('access.denied', 'Reviewing is for signed-in people.');
    const projectId = decodeId('project', input.params.projectId);
    if (!projectId) throw new AppError('project.not_found');
    const id = input.params.lateSubmissionId
      ? decodeId('lateSubmission', input.params.lateSubmissionId)
      : null;
    if (input.params.lateSubmissionId && !id) throw new AppError('late_submission.not_found');
    return { tenant, projectId, id: id as string };
  }
  return defineRoutes({
    listLateSubmissions: async (input) => {
      const { tenant, projectId } = reviewer(input);
      const body = await database.withTenantTx(
        tenant,
        (scope) =>
          review.list(scope, projectId, {
            status: input.query.status ?? 'pending',
            limit: input.query.limit ?? 50,
          }),
        { readOnly: true },
      );
      return { status: 200, body };
    },
    acceptLateSubmission: async (input) => {
      const { tenant, projectId, id } = reviewer(input);
      const body = await database.withTenantTx(tenant, (scope) =>
        review.accept(scope, projectId, id),
      );
      return { status: 200, body };
    },
    rejectLateSubmission: async (input) => {
      const { tenant, projectId, id } = reviewer(input);
      const body = await database.withTenantTx(tenant, (scope) =>
        review.reject(scope, projectId, id, input.body?.note),
      );
      return { status: 200, body };
    },
    endDrainGrants: async (input) => {
      const { tenant, projectId } = reviewer(input);
      const userId = decodeId('user', input.body.userId);
      if (!userId) throw new AppError('validation_failed', 'userId is not valid');
      const ended = await database.withTenantTx(tenant, async (scope) => {
        const n = await drain.revoke(scope, { userId, projectId });
        if (n > 0)
          scope.events.add({
            type: 'sync.drain_grant.ended.v1',
            projectId,
            entityType: 'drain_grant',
            entityId: userId,
            entityVersion: 1,
            data: { userId, endedBy: scope.ctx.userId, ended: n },
          });
        return n;
      });
      return { status: 200, body: { ended } };
    },
    syncPull: async (input) => {
      const q = input.query;
      const scopes = parseScopes(q.scopes);
      const since = Number(q.since);
      if (!scopes || !Number.isSafeInteger(since))
        throw new AppError('validation_failed', 'Invalid sync scopes or checkpoint', [
          { path: 'scopes', message: 'Expected project:{projectId}:{module,module};org' },
        ]);
      // An access-link session never syncs; signed-in members and external collaborators do (Sam, #104).
      const tenant = requireTenant(input);
      if (tenant.actor)
        throw new AppError(
          'access.denied',
          'Offline sync is for signed-in people, not link sessions.',
        );
      const body = await database.withTenantTx(
        tenant,
        (scope) => pull.pull(scope, { scopes, since, limit: q.limit }),
        { readOnly: true },
      );
      // A device told it lost a whole project gets the grant for work it queued (X38). That writes, so it is its
      // own transaction; nothing here changes what the pull itself returned.
      const lost = body.revokedScopes.filter((r) => r.module === null);
      if (lost.length > 0) {
        const grants = await database.withTenantTx(tenant, (scope) =>
          pull.grantsFor(
            scope,
            lost.map((r) => decodeId('project', r.projectId)!),
          ),
        );
        body.revokedScopes = body.revokedScopes.map((r) => {
          const drainGrant = r.module === null ? grants.get(r.projectId) : undefined;
          return drainGrant ? { ...r, drainGrant } : r;
        });
      }
      // The body can carry a drain grant, a secret: no cache, whatever sits in front.
      return { status: 200, body, headers: { 'cache-control': 'no-store' } };
    },
    syncPush: async (input) => {
      const tenant = requireTenant(input);
      if (tenant.actor)
        throw new AppError(
          'access.denied',
          'Offline sync is for signed-in people, not link sessions.',
        );
      return { status: 200, body: await push.push(tenant, input.body) };
    },
  });
}
