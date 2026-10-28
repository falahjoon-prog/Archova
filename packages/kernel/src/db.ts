import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { uuidv7 } from '@archova/domain';
import type { EventEnvelope } from '@archova/contracts';
import type { TenantContext } from './context';
import { currentRequestContext } from './context';

export type Db = NodePgDatabase;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface ChangeRecord {
  module: string;
  entityType: string;
  entityId: string;
  op: 'upsert' | 'delete' | 'access_revoked';
  version: number | null;
  projectId?: string | null;
  scopeCompanyId?: string | null;
  isPrivate?: boolean;
}

export interface PendingEvent {
  type: string;
  projectId?: string | null;
  entityType: string;
  entityId: string;
  entityVersion?: number | null;
  data: unknown;
}

/** Handle every use case receives. Repositories take `scope.tx`; they never open connections. */
export interface TenantScope {
  tx: Tx;
  ctx: TenantContext;
  /** Outbox events, flushed in the same transaction before commit (backend 01 §3 rule 4). */
  events: { add(event: PendingEvent): void; pending(): readonly PendingEvent[] };
  /** Appends a `shared.change_feed` row (sync, search, read models) in this transaction. */
  recordChange(change: ChangeRecord): Promise<number>;
}

export interface TxOptions {
  /** `statement_timeout`; 5s for requests, 60s for jobs (backend 02 §2). */
  statementTimeout?: '5s' | '60s';
  readOnly?: boolean;
}

export interface Database {
  readonly pool: pg.Pool;
  readonly db: Db;
  /**
   * Runs `fn` in one transaction with `app.org_id` / `app.user_id` set via `set_config(…, true)`
   * (equivalent to `SET LOCAL`), so a pooled connection never carries tenant context to the next caller.
   */
  withTenantTx<T>(
    ctx: TenantContext,
    fn: (scope: TenantScope) => Promise<T>,
    opts?: TxOptions,
  ): Promise<T>;
  /**
   * Transaction with no tenant context, for global-layer modules only (`identity`). Tenant tables are
   * unreachable here: their RLS policies call `current_setting('app.org_id')`, which errors when unset.
   */
  withGlobalTx<T>(owner: 'identity', fn: (tx: Tx) => Promise<T>, opts?: TxOptions): Promise<T>;
  /**
   * Self scope (ADR-0007): read-only transaction where only `self_read` policies match, i.e. the
   * caller's own memberships and the orgs they belong to. Used by GET /v1/me before an org is chosen.
   */
  withSelfTx<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, opts: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 10 });
  const db = drizzle(pool);

  async function begin(tx: Tx, o: TxOptions | undefined) {
    if (o?.statementTimeout === '60s') await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
    else await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    if (o?.readOnly) await tx.execute(sql`SET TRANSACTION READ ONLY`);
  }

  return {
    pool,
    db,
    async withTenantTx(ctx, fn, o) {
      return db.transaction(async (tx) => {
        await begin(tx, o);
        await tx.execute(
          sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.user_id', ${ctx.userId}, true)`,
        );
        const pending: PendingEvent[] = [];
        const scope: TenantScope = {
          tx,
          ctx,
          events: { add: (e) => void pending.push(e), pending: () => pending },
          recordChange: (change) => appendChange(tx, ctx.orgId, change),
        };
        const result = await fn(scope);
        if (pending.length) await flushOutbox(tx, ctx, pending);
        return result;
      });
    },
    async withGlobalTx(_owner, fn, o) {
      return db.transaction(async (tx) => {
        await begin(tx, o);
        return fn(tx);
      });
    },
    async withSelfTx(userId, fn) {
      return db.transaction(async (tx) => {
        await begin(tx, { readOnly: true });
        await tx.execute(
          sql`select set_config('app.org_id', ${NIL_UUID}, true), set_config('app.self_user_id', ${userId}, true)`,
        );
        return fn(tx);
      });
    },
    close: () => pool.end(),
  };
}

async function appendChange(tx: Tx, orgId: string, c: ChangeRecord): Promise<number> {
  const seqRes = await tx.execute<{ last_seq: string }>(sql`
    insert into shared.org_sequences (org_id, last_seq) values (${orgId}, 1)
    on conflict (org_id) do update set last_seq = shared.org_sequences.last_seq + 1
    returning last_seq`);
  const seq = Number(seqRes.rows[0]!.last_seq);
  await tx.execute(sql`
    insert into shared.change_feed
      (org_id, seq, project_id, module, entity_type, entity_id, op, version, scope_company_id, is_private)
    values (${orgId}, ${seq}, ${c.projectId ?? null}, ${c.module}, ${c.entityType}, ${c.entityId}, ${c.op},
            ${c.version}, ${c.scopeCompanyId ?? null}, ${c.isPrivate ?? false})`);
  return seq;
}

async function flushOutbox(tx: Tx, ctx: TenantContext, events: readonly PendingEvent[]) {
  const traceId = currentRequestContext()?.traceId ?? null;
  for (const e of events) {
    await tx.execute(sql`
      insert into shared.outbox
        (id, org_id, type, project_id, entity_type, entity_id, entity_version, actor, data, trace_id, occurred_at)
      values (${uuidv7()}, ${ctx.orgId}, ${e.type}, ${e.projectId ?? null}, ${e.entityType}, ${e.entityId},
              ${e.entityVersion ?? null}, ${JSON.stringify(actorOf(ctx))}::jsonb,
              ${JSON.stringify(e.data)}::jsonb, ${traceId}, now())`);
  }
}

/** The event actor: a signed-in user, or a person on an access link (Sam 11 §3: `actor.type = link`). */
function actorOf(ctx: TenantContext) {
  return ctx.actor
    ? {
        type: 'link',
        id: ctx.actor.linkId,
        subjectType: ctx.actor.subjectType,
        subjectId: ctx.actor.subjectId,
      }
    : { type: 'user', id: ctx.userId };
}

/** Shape of an outbox row once relayed; used by the worker's dispatcher. */
export type OutboxEvent = EventEnvelope;
