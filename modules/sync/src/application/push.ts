import { and, eq } from 'drizzle-orm';
import type { SyncPushRequest, SyncPushResponse } from '@archova/contracts';
import { CORE_MODULES } from '@archova/domain';
import {
  isAppError,
  type AppError,
  type Database,
  type SyncCommand,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import { mutations } from '../infra/tables';
import { createLimiter } from './drain';

/** Mutations one person may push per minute: a week of queued site work fits, a runaway loop does not. */
export const PUSH_MUTATIONS_PER_WINDOW = 600;

type Mutation = SyncPushRequest['mutations'][number];
type Result = SyncPushResponse['results'][number];

export interface PushDeps {
  database: Database;
  commands: readonly SyncCommand[];
}

const rejected = (mutationId: string, code: string, detail?: string): Result => ({
  mutationId,
  status: 'rejected',
  problem: { code, ...(detail ? { detail } : {}) },
});

/**
 * Mobile push (backend 04 §4). Mutations run in request order, each in its own transaction, so one failure never
 * rolls back the batch. `mutationId` is the idempotency key, scoped to the caller: a replay returns the stored result
 * without running the command again.
 */
export function createPushService(deps: PushDeps) {
  const commands = new Map(deps.commands.map((c) => [c.name, c]));
  // Per-process, per person; the edge per-IP limit is the cap across instances.
  const perUser = createLimiter(PUSH_MUTATIONS_PER_WINDOW);

  function entitlementProblem(
    tenant: TenantContext,
    command: SyncCommand,
  ): Result['problem'] | null {
    const ent = tenant.entitlements;
    if (
      !(CORE_MODULES as readonly string[]).includes(command.module) &&
      !ent.modules.includes(command.module)
    )
      return { code: 'entitlement-required', detail: 'Your plan does not include this feature.' };
    if (ent.state === 'read_only' || ent.state === 'cancelled')
      return { code: 'org.read_only', detail: 'This organisation is read-only.' };
    return null;
  }

  async function apply(tenant: TenantContext, command: SyncCommand, m: Mutation): Promise<Result> {
    return deps.database.withTenantTx(tenant, async (scope) => {
      const key = and(
        eq(mutations.orgId, tenant.orgId),
        eq(mutations.userId, tenant.userId),
        eq(mutations.mutationId, m.mutationId),
      );
      // The claim also serialises two sends of the same mutation: the second waits here, then reads the result.
      const claimed = await scope.tx
        .insert(mutations)
        .values({
          orgId: tenant.orgId,
          userId: tenant.userId,
          mutationId: m.mutationId,
          command: m.command,
          entityId: m.entityId,
          status: 'pending',
        })
        .onConflictDoNothing()
        .returning({ mutationId: mutations.mutationId });
      if (claimed.length === 0) return replay(scope, key, m);
      const out = await command.run(scope, {
        entityId: m.entityId,
        baseVersion: m.baseVersion,
        clientAt: new Date(m.clientAt),
        payload: m.payload,
      });
      await scope.tx.update(mutations).set({ status: 'applied', version: out.version }).where(key);
      return { mutationId: m.mutationId, status: 'applied', version: out.version };
    });
  }

  async function replay(
    scope: TenantScope,
    key: ReturnType<typeof and>,
    m: Mutation,
  ): Promise<Result> {
    const [row] = await scope.tx.select().from(mutations).where(key).limit(1);
    if (!row || row.command !== m.command || row.entityId !== m.entityId)
      return rejected(
        m.mutationId,
        'validation_failed',
        'That mutation id was already used for something else.',
      );
    if (row.status === 'applied')
      return {
        mutationId: m.mutationId,
        status: 'applied',
        ...(row.version !== null ? { version: row.version } : {}),
      };
    return {
      mutationId: m.mutationId,
      status: 'rejected',
      problem: row.problem ?? { code: 'validation_failed' },
    };
  }

  async function conflict(
    tenant: TenantContext,
    command: SyncCommand,
    m: Mutation,
  ): Promise<Result> {
    const current = await deps.database.withTenantTx(
      tenant,
      (scope) => command.current(scope, m.entityId),
      {
        readOnly: true,
      },
    );
    return {
      mutationId: m.mutationId,
      status: 'conflict',
      ...(current ? { version: current.version, server: current.data } : {}),
      problem: { code: 'version_conflict' },
    };
  }

  /**
   * A rejection is stored so a replay answers the same, but only when it is deterministic: not `access.*` (a grant or
   * the drain-grant retry may change the answer), and not a timeout, 429 or 5xx (a retry may well succeed).
   */
  const storable = (e: AppError) =>
    !e.code.startsWith('access.') && e.status < 500 && e.status !== 429 && e.status !== 408;

  async function storeRejection(
    tenant: TenantContext,
    m: Mutation,
    problem: { code: string; detail?: string },
  ) {
    if (problem.code === 'access.revoked') return;
    await deps.database.withTenantTx(tenant, (scope) =>
      scope.tx
        .insert(mutations)
        .values({
          orgId: tenant.orgId,
          userId: tenant.userId,
          mutationId: m.mutationId,
          command: m.command,
          entityId: m.entityId,
          status: 'rejected',
          problem,
        })
        .onConflictDoNothing(),
    );
  }

  async function one(tenant: TenantContext, m: Mutation): Promise<Result> {
    const command = commands.get(m.command);
    if (!command)
      return rejected(m.mutationId, 'validation_failed', `Unknown command ${m.command}.`);
    const blocked = entitlementProblem(tenant, command);
    if (blocked) return { mutationId: m.mutationId, status: 'rejected', problem: blocked };
    try {
      return await apply(tenant, command, m);
    } catch (e) {
      if (!isAppError(e)) throw e;
      if (e.code === 'version_conflict') return conflict(tenant, command, m);
      const problem = { code: e.code as string, detail: e.message };
      if (storable(e)) await storeRejection(tenant, m, problem);
      return { mutationId: m.mutationId, status: 'rejected', problem };
    }
  }

  async function push(tenant: TenantContext, req: SyncPushRequest): Promise<SyncPushResponse> {
    const results: Result[] = [];
    const key = `${tenant.orgId}:${tenant.userId}`;
    for (const m of req.mutations) {
      // Past the per-person cap the rest of the batch is turned away, not stored: the device retries after the window.
      if (!perUser.hit(key)) {
        results.push(
          rejected(
            m.mutationId,
            'rate_limited',
            'Too many changes sent at once. Try again shortly.',
          ),
        );
        continue;
      }
      results.push(await one(tenant, m));
    }
    return { results };
  }

  return { push };
}

export type PushService = ReturnType<typeof createPushService>;
