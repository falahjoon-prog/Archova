// Keeps Nova's index in step with RFIs, defects and diary days (backend 08 §2, ai/03 §5). Loaded by the ai-worker only.
//
// Two stages per change event, so a record is never searchable in a form it no longer has:
//  1. at once (`subscribers-ai`): delete whatever stored text no longer matches the register, with no model call;
//  2. after a short window (`ai-reindex`): embed the current text. One job per record per window, so a burst of
//     edits to one record is a single embedding run that reads the latest text.
// The worker acts as `AI_INDEX_ACTOR` in the event's own org: no person, no org role, no project membership.
import { UnrecoverableError } from 'bullmq';
import { isAppError, type Entitlements, type TenantContext } from '@archova/kernel';
import { AI_INDEX_ACTOR, recordKindOf, type RecordKind } from '@archova/mod-ai';
import type { StoredEvent, Subscriber } from '../subscribers';
import { ROUTED_RETRY } from '../queues';
import { AI_REINDEX_ROUTE } from './declaration';

export const REINDEX_QUEUE = 'ai-reindex';
export const REINDEX_JOB = 'reindex-record';
/** How long a record's changes are gathered before its text is embedded. Also the width of the dedupe bucket. */
export const DEBOUNCE_MS = 60_000;
/** Added to the delay so a job never starts inside the window whose events it stands for, whatever the clock skew. */
const SLACK_MS = 2_000;
/** Records held back by the org's daily embedding cap start over this long after it resets, not all at the same moment. */
const SPREAD_MS = 15 * 60_000;

export interface ReindexJob {
  orgId: string;
  projectId: string;
  kind: RecordKind;
  recordId: string;
}

/** The two entry points of `modules.ai.api` the job calls; they check no permission, so only this file names them. */
export interface RecordIndexer {
  dropStaleRecord(
    ctx: TenantContext,
    projectId: string,
    kind: RecordKind,
    recordId: string,
  ): Promise<{ isSource: boolean }>;
  reindexRecord(
    ctx: TenantContext,
    projectId: string,
    kind: RecordKind,
    recordId: string,
  ): Promise<unknown>;
}

export interface ReindexDeps {
  ai: RecordIndexer;
  /** The org's plan as billing reports it now. */
  entitlementsFor(orgId: string): Promise<Entitlements>;
  /** False once the org is deleted. */
  orgExists(orgId: string): Promise<boolean>;
  queue: {
    add(
      name: string,
      data: ReindexJob,
      opts: {
        jobId: string;
        delay: number;
        attempts: number;
        backoff: { type: string; delay: number };
        removeOnComplete: { age: number; count: number };
        removeOnFail: { age: number };
      },
    ): Promise<unknown>;
  };
  /** Counts and ids only: chunk text and record text are never logged. */
  log: (msg: string, o: object) => void;
  now?: () => Date;
  debounceMs?: number;
}

/** Why a plan or an org setting means no embedding happens: not a failure, so the job ends without a retry. */
const NOVA_UNAVAILABLE = new Set(['entitlement-required', 'ai.disabled', 'ai.feature_disabled']);

/** The context for Nova's background work: the org's own plan, the system actor, nothing else. */
export function indexContext(
  orgId: string,
  entitlements: Entitlements,
  requestId: string,
): TenantContext {
  return {
    orgId,
    userId: AI_INDEX_ACTOR,
    principalType: 'member',
    orgRole: null,
    entitlements,
    requestId,
  };
}

/** Statuses that mean "not now" rather than "never": the same job can succeed when tried again. */
const TRY_LATER = new Set([408, 409, 412, 423, 425, 429]);

/**
 * Whether trying again cannot change the outcome: the request itself is wrong (a record, project or folder that is gone,
 * a permission the actor lacks, input that does not validate). The `ai.*` codes are left out because they describe the
 * provider and the org's own limits, which change.
 */
export function isDeterministic(err: unknown): boolean {
  return (
    isAppError(err) &&
    err.status >= 400 &&
    err.status < 500 &&
    !TRY_LATER.has(err.status) &&
    !err.code.startsWith('ai.')
  );
}

/**
 * What a failed job leaves behind: its kind, never its message or stack. BullMQ keeps a failed job's reason and stack
 * trace in Redis for 14 days, and a message from a provider or the database could carry some of the text being embedded.
 * A deterministic failure is unrecoverable, so BullMQ fails the job at once instead of retrying it for an hour; the
 * nightly sweep covers the record.
 */
export function sanitizeFailure(err: unknown): Error {
  const kind = isAppError(err) ? err.code : err instanceof Error ? err.name : 'unknown';
  const message = `ai job failed: ${kind}`;
  const out = isDeterministic(err) ? new UnrecoverableError(message) : new Error(message);
  out.stack = `${out.name}: ${message}`;
  return out;
}

/** Deleting and re-stamping need no plan, so they run with an empty one. */
export const NO_PLAN: Entitlements = { plan: 'system', state: 'active', modules: [], limits: {} };

export function createReindex(deps: ReindexDeps) {
  const now = deps.now ?? (() => new Date());
  const window = deps.debounceMs ?? DEBOUNCE_MS;

  /**
   * The org's daily embedding cap is used up: embed the record after the cap resets instead of retrying against it
   * for an hour. One deferred job per record per reset, however many jobs hit the cap, and spread across the first
   * minutes of the new day by record so a day of backlog does not start at once. False if the reset time is unusable.
   */
  async function deferToReset(job: ReindexJob, resetsAt: unknown): Promise<boolean> {
    const reset = typeof resetsAt === 'string' ? Date.parse(resetsAt) : Number.NaN;
    if (!Number.isFinite(reset)) return false;
    let spread = 0;
    for (const c of job.recordId) spread = (spread * 31 + c.charCodeAt(0)) >>> 0;
    await deps.queue.add(REINDEX_JOB, job, {
      jobId: `${job.orgId}.${job.kind}.${job.recordId}.after.${reset}`,
      delay: Math.max(0, reset - now().getTime()) + SLACK_MS + (spread % SPREAD_MS),
      ...ROUTED_RETRY,
      removeOnComplete: { age: 3600, count: 10_000 },
      removeOnFail: { age: 14 * 86_400 },
    });
    return true;
  }

  /** Stage 1: runs for every change event of an RFI, defect or diary day. */
  async function dropAndSchedule(event: StoredEvent) {
    const kind = recordKindOf(event.type);
    if (!kind || !event.projectId) return;
    const ctx = indexContext(event.orgId, NO_PLAN, `ai-drop:${event.id}`);
    const { isSource } = await deps.ai.dropStaleRecord(ctx, event.projectId, kind, event.entityId);
    // Voided, deleted or still a draft: nothing to embed, and nothing left to find.
    if (!isSource) return;
    const bucket = Math.floor(now().getTime() / window);
    const job: ReindexJob = {
      orgId: event.orgId,
      projectId: event.projectId,
      kind,
      recordId: event.entityId,
    };
    await deps.queue.add(REINDEX_JOB, job, {
      // Same record, same window: one job. The next window gets its own, so a change made while one runs is not lost.
      jobId: `${event.orgId}.${kind}.${event.entityId}.${bucket}`,
      delay: window + SLACK_MS,
      // A job that fails leaves a record unsearchable until its next change or a full index run: retry for about an hour.
      ...ROUTED_RETRY,
      removeOnComplete: { age: 3600, count: 10_000 },
      removeOnFail: { age: 14 * 86_400 },
    });
  }

  const subscriber: Subscriber = {
    ...AI_REINDEX_ROUTE,
    async handle(event) {
      try {
        await dropAndSchedule(event);
      } catch (err) {
        throw sanitizeFailure(err);
      }
    },
  };

  /** Stage 2: embeds the record's current text if it is new. Safe to repeat. */
  async function embedRecord(job: ReindexJob): Promise<void> {
    const where = {
      orgId: job.orgId,
      projectId: job.projectId,
      kind: job.kind,
      recordId: job.recordId,
    };
    if (!(await deps.orgExists(job.orgId))) {
      deps.log('ai re-index skipped', { ...where, reason: 'org_deleted' });
      return;
    }
    const entitlements = await deps.entitlementsFor(job.orgId);
    if (entitlements.state === 'read_only' || entitlements.state === 'cancelled') {
      deps.log('ai re-index skipped', { ...where, reason: `org_${entitlements.state}` });
      return;
    }
    const ctx = indexContext(job.orgId, entitlements, `ai-reindex:${job.kind}:${job.recordId}`);
    try {
      const counts = await deps.ai.reindexRecord(ctx, job.projectId, job.kind, job.recordId);
      deps.log('ai re-index done', { ...where, counts });
    } catch (err) {
      // No Nova on the plan, or switched off for the org or the feature: the stale text is already gone (stage 1).
      if (isAppError(err) && NOVA_UNAVAILABLE.has(err.code)) {
        deps.log('ai re-index skipped', { ...where, reason: err.code });
        return;
      }
      if (
        isAppError(err) &&
        err.code === 'ai.embedding_limit' &&
        (await deferToReset(job, err.extra?.resetsAt))
      ) {
        deps.log('ai re-index deferred', { ...where, resetsAt: err.extra?.resetsAt });
        return;
      }
      throw err;
    }
  }

  async function reindex(job: ReindexJob): Promise<void> {
    try {
      await embedRecord(job);
    } catch (err) {
      throw sanitizeFailure(err);
    }
  }

  return { subscriber, reindex };
}

/** Whether `err` is the platform module saying the org is gone; used to build `orgExists`. */
export const isOrgGone = (err: unknown) => isAppError(err) && err.code === 'org.not_found';
