import { AppError, defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { PullService } from '../application/pull';
import { parseScopes } from '../domain/scopes';

export function syncRoutes(database: Database, pull: PullService) {
  return defineRoutes({
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
      return { status: 200, body };
    },
    syncPush: async () => {
      throw new AppError('not_implemented', 'Mobile sync push is not available yet.');
    },
  });
}
