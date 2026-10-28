import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, gt, isNull } from 'drizzle-orm';
import type { DrainGrant, SyncPushRequest, SyncPushResponse } from '@archova/contracts';
import { decodeId, encodeId } from '@archova/domain';
import {
  AppError,
  type Database,
  type SyncCommand,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import { drainGrants, lateSubmissions, mutations } from '../infra/tables';

type Mutation = SyncPushRequest['mutations'][number];
type Result = SyncPushResponse['results'][number];

export const DRAIN_TOKEN_PREFIX = 'dg_';
const TOKEN_SHAPE = /^dg_[A-Za-z0-9_-]{43}$/;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Sam's caps (X38): small enough that a revoked person's phone cannot fill the queue or the database. */
export const DRAIN_LIMITS = {
  payloadBytes: 256 * 1024,
  requestBytes: 1024 * 1024,
  queuedPerGrant: 100,
  /** Grants minted for one scope before an admin has to step in. */
  rotations: 3,
  windowMs: 60_000,
  requestsPerWindow: 30,
  /** Tokens that do not resolve, per caller address: stops guessing without a table that grows with guesses. */
  badTokensPerWindow: 20,
  limiterEntries: 10_000,
} as const;

/** Fixed-window counter by key. Entries age out from the oldest, so a call never scans the whole map. */
function createLimiter(limit: number) {
  const entries = new Map<string, { start: number; n: number }>();
  const sweep = (now: number) => {
    for (const [k, v] of entries) {
      if (now - v.start <= DRAIN_LIMITS.windowMs && entries.size <= DRAIN_LIMITS.limiterEntries)
        break;
      entries.delete(k);
    }
  };
  return {
    over(key: string) {
      const e = entries.get(key);
      return Boolean(e && Date.now() - e.start <= DRAIN_LIMITS.windowMs && e.n >= limit);
    },
    hit(key: string) {
      const now = Date.now();
      sweep(now);
      const e = entries.get(key);
      if (!e || now - e.start > DRAIN_LIMITS.windowMs) {
        entries.delete(key);
        entries.set(key, { start: now, n: 1 });
      } else e.n += 1;
      return (entries.get(key)?.n ?? 0) <= limit;
    },
  };
}

const HOURS_72 = 72 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const isDrainToken = (value: string) => value.startsWith(DRAIN_TOKEN_PREFIX);

const rejected = (mutationId: string, code: string, detail: string): Result => ({
  mutationId,
  status: 'rejected',
  problem: { code, detail },
});

export interface DrainDeps {
  database: Database;
  commands: readonly SyncCommand[];
}

/**
 * The drain grant (X38): what a person whose access just ended may still do with work queued on their phone. The
 * grant can only queue a mutation for an admin to review. It never runs one and never reads a record, so it cannot be
 * used to learn what exists: the only checks are the token, the scope it was minted for, and whether the command may
 * be queued at all.
 */
export function createDrainService(deps: DrainDeps) {
  const commands = new Map(deps.commands.map((c) => [c.name, c]));
  // Per-process limiters; the edge per-IP limit (infrastructure 04) is the real cap across instances.
  const perGrant = createLimiter(DRAIN_LIMITS.requestsPerWindow);
  const badTokens = createLimiter(DRAIN_LIMITS.badTokensPerWindow);

  /**
   * Mints the grant for a scope that was just revoked, replacing any live one (a lost token is rotated, never
   * reused). Returns null once the scope has used its rotations; an admin then decides. Called by the offboarding
   * paths; the token is shown once.
   */
  async function issue(
    scope: TenantScope,
    input: {
      userId: string;
      projectId: string | null;
      module: string | null;
      accessEndedAt: Date;
    },
  ): Promise<DrainGrant | null> {
    const same = and(
      eq(drainGrants.orgId, scope.ctx.orgId),
      eq(drainGrants.userId, input.userId),
      input.projectId ? eq(drainGrants.projectId, input.projectId) : isNull(drainGrants.projectId),
      input.module ? eq(drainGrants.module, input.module) : isNull(drainGrants.module),
    );
    const [{ n } = { n: 0 }] = await scope.tx.select({ n: count() }).from(drainGrants).where(same);
    if (Number(n) >= DRAIN_LIMITS.rotations) return null;
    await scope.tx
      .update(drainGrants)
      .set({ revokedAt: new Date() })
      .where(and(same, isNull(drainGrants.revokedAt)));
    const token = DRAIN_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const expiresAt = new Date(input.accessEndedAt.getTime() + HOURS_72);
    await scope.tx.insert(drainGrants).values({
      orgId: scope.ctx.orgId,
      userId: input.userId,
      projectId: input.projectId,
      module: input.module,
      tokenHash: hashToken(token),
      expiresAt,
    });
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      orgId: encodeId('org', scope.ctx.orgId),
      projectId: input.projectId ? encodeId('project', input.projectId) : null,
      module: input.module,
    };
  }

  /** Ends every live grant a person holds in the organisation that is inside `projectId`/`module` (re-add, erasure). */
  async function revoke(
    scope: TenantScope,
    input: { userId: string; projectId?: string | null; module?: string | null },
  ) {
    await scope.tx
      .update(drainGrants)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(drainGrants.orgId, scope.ctx.orgId),
          eq(drainGrants.userId, input.userId),
          isNull(drainGrants.revokedAt),
          input.projectId ? eq(drainGrants.projectId, input.projectId) : undefined,
          input.module ? eq(drainGrants.module, input.module) : undefined,
        ),
      );
  }

  async function queue(
    scope: TenantScope,
    grant: typeof drainGrants.$inferSelect,
    m: Mutation,
    room: { left: number },
  ): Promise<Result> {
    const command = commands.get(m.command);
    // One answer for an unknown and a non-drainable command, so the reply says nothing about the server.
    if (!command?.drainable)
      return rejected(m.mutationId, 'validation_failed', 'That change cannot be sent now.');
    const projectId = m.projectId ? decodeId('project', m.projectId) : null;
    if (!projectId)
      return rejected(
        m.mutationId,
        'validation_failed',
        'projectId is required when sending late.',
      );
    if (
      (grant.projectId && grant.projectId !== projectId) ||
      (grant.module && grant.module !== command.module)
    )
      return rejected(m.mutationId, 'access.denied', 'Your access to that was not ended.');
    if (JSON.stringify(m.payload).length > DRAIN_LIMITS.payloadBytes)
      return rejected(m.mutationId, 'validation_failed', 'That change is too large to send now.');

    // A change that already went through a normal push (its answer was lost) keeps that answer. Queueing it would
    // let the accept run it a second time.
    const [done] = await scope.tx
      .select()
      .from(mutations)
      .where(and(eq(mutations.userId, grant.userId), eq(mutations.mutationId, m.mutationId)));
    if (done) {
      if (done.command !== m.command || done.entityId !== m.entityId)
        return rejected(
          m.mutationId,
          'validation_failed',
          'That mutation id was already used for something else.',
        );
      if (done.status === 'applied')
        return {
          mutationId: m.mutationId,
          status: 'applied',
          ...(done.version !== null ? { version: done.version } : {}),
        };
      return {
        mutationId: m.mutationId,
        status: 'rejected',
        problem: done.problem ?? { code: 'validation_failed' },
      };
    }
    // A resend is the same row; reusing an id for something else is refused.
    const [existing] = await scope.tx
      .select({ command: lateSubmissions.command, entityId: lateSubmissions.entityId })
      .from(lateSubmissions)
      .where(
        and(eq(lateSubmissions.userId, grant.userId), eq(lateSubmissions.mutationId, m.mutationId)),
      );
    if (existing) {
      if (existing.command !== m.command || existing.entityId !== m.entityId)
        return rejected(
          m.mutationId,
          'validation_failed',
          'That mutation id was already used for something else.',
        );
      return { mutationId: m.mutationId, status: 'pending_review' };
    }
    if (room.left <= 0)
      return rejected(m.mutationId, 'rate_limited', 'Too many changes are waiting.');
    room.left -= 1;
    await scope.tx
      .insert(lateSubmissions)
      .values({
        orgId: grant.orgId,
        userId: grant.userId,
        mutationId: m.mutationId,
        grantId: grant.id,
        projectId,
        module: command.module,
        command: m.command,
        entityId: m.entityId,
        baseVersion: m.baseVersion,
        clientAt: new Date(m.clientAt),
        payload: m.payload,
      })
      .onConflictDoNothing();
    return { mutationId: m.mutationId, status: 'pending_review' };
  }

  /**
   * Handles a `syncPush` sent with a drain grant. `orgId` comes from the URL, so a token only ever resolves inside
   * its own organisation (row security). Every mutation is held and answered `pending_review`.
   */
  async function handle(
    orgId: string,
    token: string,
    req: SyncPushRequest,
    requestId: string,
    ip: string,
  ): Promise<SyncPushResponse> {
    const tooMany = () => new AppError('rate_limited', 'Too many requests. Try again shortly.');
    const invalid = () => {
      if (!badTokens.hit(ip)) return tooMany();
      return new AppError(
        'auth.session_revoked',
        'The access token is invalid, expired or revoked.',
      );
    };
    if (badTokens.over(ip)) throw tooMany();
    const hash = TOKEN_SHAPE.test(token) ? hashToken(token) : null;
    if (!hash) throw invalid();
    if (JSON.stringify(req).length > DRAIN_LIMITS.requestBytes)
      throw new AppError('validation_failed', 'That request is too large.');

    // No membership exists any more, so the context is built from the grant itself once it is found.
    const probe: TenantContext = {
      orgId,
      userId: NIL_UUID,
      principalType: 'external',
      orgRole: null,
      entitlements: { plan: '', state: 'active', modules: [], limits: {} },
      requestId,
    };
    return deps.database.withTenantTx(probe, async (scope) => {
      const [grant] = await scope.tx
        .select()
        .from(drainGrants)
        .where(
          and(
            eq(drainGrants.tokenHash, hash),
            isNull(drainGrants.revokedAt),
            gt(drainGrants.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!grant) throw invalid();
      // Counted by grant, which exists in the table, not by whatever token a caller made up.
      if (!perGrant.hit(grant.id)) throw tooMany();

      const [{ queued } = { queued: 0 }] = await scope.tx
        .select({ queued: count() })
        .from(lateSubmissions)
        .where(
          and(
            eq(lateSubmissions.userId, grant.userId),
            eq(lateSubmissions.status, 'pending'),
            grant.projectId ? eq(lateSubmissions.projectId, grant.projectId) : undefined,
            grant.module ? eq(lateSubmissions.module, grant.module) : undefined,
          ),
        );
      const room = { left: DRAIN_LIMITS.queuedPerGrant - Number(queued) };
      const results: Result[] = [];
      for (const m of req.mutations) results.push(await queue(scope, grant, m, room));
      return { results };
    });
  }

  return { issue, revoke, handle };
}

export type DrainService = ReturnType<typeof createDrainService>;
