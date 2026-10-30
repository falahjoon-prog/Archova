// The sync engine (mobile 02): sends the outbox in order, pulls change feed deltas per scope, handles lost
// access (X14) and drain mode (X38). It holds no timers; SyncScheduler decides when to run it.

import { backoffDelay, DEFAULT_BACKOFF, type BackoffOptions } from './backoff';
import {
  commandModule,
  type AttentionReason,
  type OutboxEntry,
  type SyncStore,
  type WipeCounts,
} from './store';
import { classifyFailure, SyncHttpError, type FailureKind, type SyncTransport } from './transport';
import {
  DEFAULT_PULL_LIMIT,
  MAX_PUSH_BATCH,
  scopeKey,
  type PushMutation,
  type DrainGrant,
  type RevokedScope,
  type SyncScope,
} from './wire';

/** How long a device may keep sending queued work after access ended (X38). */
/** Problem code for a command that refers to a file the malware scan has not cleared yet (backend 04). */
export const FILE_NOT_READY = 'file.not_ready';

export const DRAIN_WINDOW_MS = 72 * 60 * 60 * 1000;

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/**
 * Access that has ended while the device still holds unsent work. `projectId: null` is the whole
 * organisation (signed out by an admin or removed); otherwise one project, or one module of it.
 */
export interface Drain {
  projectId: string | null;
  module: string | null;
  /** When access ended, if the server said; queued work created after it is not sent. */
  revokedAt: string | null;
  /** Epoch ms after which the remaining work is discarded and the data wiped. */
  until: number;
  /** The server's drain-only grant. The first one is kept: a later one would replace it server-side (X38). */
  grant?: DrainGrant;
}

export type SyncPhase =
  | 'idle'
  | 'syncing'
  /** A request failed; the scheduler retries at `nextRetryAt`. */
  | 'waiting_retry'
  /** The session needs refreshing or the user must sign in again. */
  | 'auth_required'
  /** The build is too old (426); data is kept until the user updates. */
  | 'upgrade_required'
  /** Access to this organisation ended; only queued work is being sent. */
  | 'draining'
  /** The organisation's data was deleted from the device. */
  | 'wiped';

export interface SyncStatus {
  phase: SyncPhase;
  /** Items waiting to sync ("3 items waiting to sync"). */
  pending: number;
  needsAttention: number;
  /** Sent after access ended, waiting for an admin. */
  pendingReview: number;
  drains: Drain[];
  lastSuccessAt: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
}

export type SyncEvent =
  | { type: 'status'; status: SyncStatus }
  /**
   * A scope's data was deleted: lost access (with any drain finished) or a wipe. `scope: null` is the
   * whole organisation. `discarded` counts queued work that was never delivered, for the wipe report.
   */
  | { type: 'purged'; scope: RevokedScope | null; discarded: WipeCounts };

export type SyncOutcome =
  | { ok: true }
  /** `wiped`: the organisation's data is gone; nothing more to sync on this store. */
  | { ok: false; kind: FailureKind | 'wiped'; retryAt: number | null; error: unknown };

export interface SyncEngineOptions {
  store: SyncStore;
  transport: SyncTransport;
  /** The scopes this device keeps offline: the projects the user chose, their modules, and `org`. */
  scopes: () => SyncScope[] | Promise<SyncScope[]>;
  clock?: Clock;
  random?: () => number;
  backoff?: BackoffOptions;
  pushBatchSize?: number;
  pullLimit?: number;
}

export interface SyncRunOptions {
  /** False for a push-only run after a local write (02 §2.6). */
  pull?: boolean;
}

function matchesScope(
  entry: OutboxEntry,
  scope: { projectId: string | null; module: string | null },
) {
  if (scope.projectId === null) return true;
  if (entry.projectId !== scope.projectId) return false;
  return scope.module === null || commandModule(entry.command) === scope.module;
}

function scopeRevokedBy(scope: SyncScope, revoked: RevokedScope): boolean {
  if (scope.kind === 'org') return false;
  if (scope.projectId !== revoked.projectId) return false;
  return revoked.module === null || revoked.module === scope.module;
}

function countByType(entries: OutboxEntry[]): WipeCounts {
  const counts: WipeCounts = {};
  for (const e of entries) counts[e.entityType] = (counts[e.entityType] ?? 0) + 1;
  return counts;
}

function sameRevokedScope(a: RevokedScope, b: RevokedScope) {
  return a.projectId === b.projectId && a.module === b.module;
}

export class SyncEngine {
  private readonly store: SyncStore;
  private readonly transport: SyncTransport;
  private readonly scopes: SyncEngineOptions['scopes'];
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly backoff: BackoffOptions;
  private readonly pushBatchSize: number;
  private readonly pullLimit: number;

  private readonly listeners = new Set<(event: SyncEvent) => void>();
  private drains: Drain[] = [];
  /** Revoked scopes not to request again, even if the app still lists them. */
  private revoked: RevokedScope[] = [];
  private phase: SyncPhase = 'idle';
  private failures = 0;
  private lastSuccessAt: number | null = null;
  private nextRetryAt: number | null = null;
  private lastError: string | null = null;
  private running: Promise<SyncOutcome> | null = null;

  constructor(options: SyncEngineOptions) {
    this.store = options.store;
    this.transport = options.transport;
    this.scopes = options.scopes;
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
    this.backoff = options.backoff ?? DEFAULT_BACKOFF;
    this.pushBatchSize = Math.min(options.pushBatchSize ?? MAX_PUSH_BATCH, MAX_PUSH_BATCH);
    this.pullLimit = options.pullLimit ?? DEFAULT_PULL_LIMIT;
  }

  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether the user may make new changes in this project (no edits while its access drains). */
  canEdit(projectId: string | null, module?: string): boolean {
    if (this.phase === 'wiped') return false;
    return !this.drains.some(
      (d) =>
        d.projectId === null ||
        (d.projectId === projectId && (d.module === null || d.module === module)),
    );
  }

  getDrains(): readonly Drain[] {
    return this.drains;
  }

  /**
   * Access to the organisation ended (admin sign-out or removal) and the API issued a drain-only grant.
   * New edits stop; only work queued before `revokedAt` is sent, for up to 72 hours (X38).
   */
  async beginOrgDrain(revokedAt: string | null, grant?: DrainGrant): Promise<void> {
    const kept = this.drains.find((d) => d.projectId === null)?.grant;
    const first = kept ?? grant;
    this.drains = [
      {
        projectId: null,
        module: null,
        revokedAt,
        until: this.clock.now() + DRAIN_WINDOW_MS,
        ...(first ? { grant: first } : {}),
      },
    ];
    await this.emitStatus();
  }

  /**
   * "Sign out and wipe now" (lost device): skip the drain and delete everything. The caller sends the
   * returned counts as the wipe report (AC23).
   */
  async wipeNow(): Promise<WipeCounts> {
    const unsent = (await this.store.listOutbox()).filter((e) => e.status !== 'pending_review');
    await this.store.wipe();
    const discarded = countByType(unsent);
    this.drains = [];
    this.phase = 'wiped';
    this.emit({ type: 'purged', scope: null, discarded });
    await this.emitStatus();
    return discarded;
  }

  /** Drop entries from "Needs attention" (the user discarded them, or reapplied them as new entries). */
  async discard(mutationIds: string[]): Promise<void> {
    await this.store.removeEntries(mutationIds);
    await this.emitStatus();
  }

  /** Run one sync. Concurrent calls share the run in progress. */
  sync(options: SyncRunOptions = {}): Promise<SyncOutcome> {
    if (!this.running) {
      this.running = this.run(options).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  async status(): Promise<SyncStatus> {
    const outbox = await this.store.listOutbox();
    const count = (s: OutboxEntry['status']) => outbox.filter((e) => e.status === s).length;
    return {
      phase: this.drains.some((d) => d.projectId === null) ? 'draining' : this.phase,
      pending: count('pending') + count('held'),
      needsAttention: count('needs_attention'),
      pendingReview: count('pending_review'),
      drains: [...this.drains],
      lastSuccessAt: this.lastSuccessAt,
      nextRetryAt: this.nextRetryAt,
      lastError: this.lastError,
    };
  }

  private async run(options: SyncRunOptions): Promise<SyncOutcome> {
    if (this.phase === 'wiped' || this.phase === 'upgrade_required') {
      return {
        ok: false,
        kind: this.phase === 'wiped' ? 'wiped' : 'upgrade',
        retryAt: null,
        error: null,
      };
    }
    this.phase = 'syncing';
    await this.emitStatus();
    try {
      const orgDrain = this.drains.find((d) => d.projectId === null);
      if (orgDrain) {
        await this.runDrain(orgDrain);
      } else {
        await this.pushNormal();
        // A drain that has no grant yet waits for the pull, which carries it (X38).
        await this.runProjectDrains(options.pull !== false);
        if (options.pull !== false) await this.pull();
        await this.runProjectDrains(false);
      }
      this.failures = 0;
      this.nextRetryAt = null;
      this.lastError = null;
      this.lastSuccessAt = this.clock.now();
      if (this.phase === 'syncing') this.phase = 'idle';
      await this.emitStatus();
      return { ok: true };
    } catch (error) {
      return this.fail(error);
    }
  }

  private async fail(error: unknown): Promise<SyncOutcome> {
    const kind = classifyFailure(error);
    this.lastError = error instanceof Error ? error.message : String(error);
    let retryAt: number | null = null;
    if (kind === 'auth') {
      this.phase = 'auth_required';
    } else if (kind === 'upgrade') {
      this.phase = 'upgrade_required';
    } else {
      this.failures++;
      const retryAfter = error instanceof SyncHttpError ? error.retryAfterMs : undefined;
      retryAt =
        this.clock.now() + backoffDelay(this.failures, this.random, this.backoff, retryAfter);
      this.phase = 'waiting_retry';
    }
    this.nextRetryAt = retryAt;
    await this.emitStatus();
    return { ok: false, kind, retryAt, error };
  }

  /** Send pending work outside any drain, in order, in batches. */
  private async pushNormal(): Promise<void> {
    await this.pushWhere((e) => !this.drains.some((d) => matchesScope(e, d)), false);
  }

  /**
   * Send pending entries accepted by `eligible`, in queue order, until none can make progress. An entry
   * whose parent is still unsent ends the batch, so it goes once the parent is applied (02 §2.4 step 7);
   * an entry whose parent failed goes to "Needs attention" without being sent.
   */
  private async pushWhere(
    eligible: (e: OutboxEntry) => boolean,
    drain: boolean,
    grant?: DrainGrant,
  ): Promise<void> {
    for (;;) {
      const all = await this.store.listOutbox();
      const byId = new Map(all.map((e) => [e.mutationId, e]));
      const failedParent: { mutationId: string; reason: AttentionReason }[] = [];
      const batch: OutboxEntry[] = [];
      const inBatch = new Set<string>();

      for (const entry of all) {
        if (entry.status !== 'pending' || !eligible(entry)) continue;
        // A second change to the same record goes after the first is answered, rebased onto its version.
        const entity = `${entry.entityType}:${entry.entityId}`;
        if (inBatch.has(entity)) break;
        const parents = entry.dependsOn.map((id) => byId.get(id)).filter((p) => p !== undefined);
        const failed = parents.find((p) => p.status === 'needs_attention');
        if (failed) {
          failedParent.push({
            mutationId: entry.mutationId,
            reason: { kind: 'dependency_failed', parentMutationId: failed.mutationId },
          });
          // Later children of this entry fail on the next pass.
          continue;
        }
        // In drain mode the server holds parents for review, so their children go with them.
        const waiting = parents.filter(
          (p) =>
            p.status === 'pending' ||
            p.status === 'held' ||
            (p.status === 'pending_review' && !drain),
        );
        // Keep queue order behind a parent this pass will send; skip past one it won't.
        if (waiting.some((p) => p.status === 'pending' && eligible(p))) break;
        if (waiting.length > 0) continue;
        batch.push(entry);
        inBatch.add(entity);
        if (batch.length >= this.pushBatchSize) break;
      }

      if (failedParent.length > 0) {
        await this.store.markNeedsAttention(failedParent);
        if (batch.length === 0) continue;
      }
      if (batch.length === 0) return;

      const mutations: PushMutation[] = batch.map((e) => ({
        mutationId: e.mutationId,
        command: e.command,
        entityId: e.entityId,
        ...(drain && e.projectId !== null ? { projectId: e.projectId } : {}),
        baseVersion: e.baseVersion,
        clientAt: e.clientAt,
        payload: e.payload,
      }));
      let response;
      try {
        response = await this.transport.push({ mutations }, grant ? { drain, grant } : { drain });
      } catch (error) {
        await this.store.recordAttempt(batch.map((e) => e.mutationId));
        throw error;
      }
      const sent = new Map(batch.map((e) => [e.mutationId, e]));
      const results = response.results.filter((r) => sent.has(r.mutationId));
      // A project the user just lost: keep that work queued and send it with the drain grant instead.
      const lostAccess = drain
        ? []
        : results.filter(
            (r) =>
              r.status === 'rejected' &&
              r.problem.code === 'access.revoked' &&
              sent.get(r.mutationId)!.projectId !== null,
          );
      for (const r of lostAccess) {
        this.startProjectDrain({
          projectId: sent.get(r.mutationId)!.projectId!,
          module: null,
          ...(r.status === 'rejected' && r.problem.drainGrant
            ? { drainGrant: r.problem.drainGrant }
            : {}),
        });
      }
      // A file still being scanned (409 `file.not_ready`) is not a failure: the command stays queued and the run
      // backs off. A blocked file (`file.blocked`, 422) is final and falls through to needs attention.
      const notReady = results.filter(
        (r) => r.status === 'rejected' && r.problem.code === FILE_NOT_READY,
      );
      await this.store.recordPushResults(
        results.filter((r) => !lostAccess.includes(r) && !notReady.includes(r)),
      );
      if (notReady.length > 0) await this.store.recordAttempt(notReady.map((r) => r.mutationId));
      if (results.length < batch.length) {
        // The server answered only part of the batch; retry the rest later rather than loop now.
        const answered = new Set(results.map((r) => r.mutationId));
        await this.store.recordAttempt(
          batch.map((e) => e.mutationId).filter((id) => !answered.has(id)),
        );
        throw new SyncHttpError(502, { message: 'Push response was missing results' });
      }
      await this.emitStatus();
      if (notReady.length > 0) {
        throw new SyncHttpError(409, {
          code: FILE_NOT_READY,
          message: 'A file is still being scanned',
        });
      }
    }
  }

  private async pull(): Promise<void> {
    // Draining scopes are in `revoked` too, so they are not pulled.
    const wanted = (await this.scopes()).filter(
      (s) => !this.revoked.some((r) => scopeRevokedBy(s, r)),
    );
    const unique = new Map(wanted.map((s) => [scopeKey(s), s]));
    if (unique.size === 0) return;
    const checkpoints = await this.store.getCheckpoints([...unique.keys()]);

    // Scopes at the same position share a request; a newly added scope starts its own full load.
    const groups = new Map<string, SyncScope[]>();
    for (const [key, scope] of unique) {
      const since = checkpoints[key] ?? '0';
      groups.set(since, [...(groups.get(since) ?? []), scope]);
    }

    for (const [start, initialScopes] of groups) {
      let scopes = initialScopes;
      let since = start;
      for (;;) {
        const page = await this.transport.pull({ scopes, since, limit: this.pullLimit });
        if (page.revokedScopes.length > 0) {
          await this.handleRevoked(page.revokedScopes);
          scopes = scopes.filter((s) => !page.revokedScopes.some((r) => scopeRevokedBy(s, r)));
        }
        await this.store.applyPull({
          changes: page.changes,
          scopeKeys: scopes.map(scopeKey),
          nextSince: page.nextSince,
        });
        since = page.nextSince;
        if (!page.hasMore || scopes.length === 0) break;
      }
    }
  }

  /**
   * Lost access (X14): purge the scope at once, unless it holds unsent work, which drains first (X38).
   */
  private async handleRevoked(revokedScopes: RevokedScope[]): Promise<void> {
    const outbox = (await this.store.listOutbox()).filter(
      (e) => e.status === 'pending' || e.status === 'held',
    );
    for (const revoked of revokedScopes) {
      if (this.revoked.some((r) => sameRevokedScope(r, revoked))) {
        this.keepGrant(revoked);
        continue;
      }
      this.revoked.push(revoked);
      if (outbox.some((e) => matchesScope(e, revoked))) {
        this.startProjectDrain(revoked);
      } else {
        const unsent = (await this.store.listOutbox()).filter(
          (e) => e.status === 'needs_attention' && matchesScope(e, revoked),
        );
        await this.store.purgeScope(revoked);
        this.emit({ type: 'purged', scope: revoked, discarded: countByType(unsent) });
      }
    }
  }

  private startProjectDrain(scope: RevokedScope) {
    if (!this.revoked.some((r) => sameRevokedScope(r, scope))) this.revoked.push(scope);
    if (this.drains.some((d) => d.projectId === scope.projectId && d.module === scope.module)) {
      this.keepGrant(scope);
      return;
    }
    this.drains.push({
      projectId: scope.projectId,
      module: scope.module,
      revokedAt: null,
      until: this.clock.now() + DRAIN_WINDOW_MS,
      ...(scope.drainGrant ? { grant: scope.drainGrant } : {}),
    });
  }

  /** A grant that arrives for a drain already under way is ignored when one is held: only the first stays valid. */
  private keepGrant(scope: RevokedScope) {
    const drain = this.drains.find(
      (d) => d.projectId === scope.projectId && d.module === scope.module,
    );
    if (drain && !drain.grant && scope.drainGrant) drain.grant = scope.drainGrant;
  }

  private async runProjectDrains(onlyWithGrant: boolean): Promise<void> {
    for (const drain of this.drains.filter(
      (d) => d.projectId !== null && (!onlyWithGrant || d.grant),
    )) {
      await this.runDrain(drain);
    }
  }

  /**
   * Send what was queued before access ended with the drain-only grant, then delete the data once
   * nothing is left to send or the 72 hours are up. The server holds what it receives for an admin.
   */
  private async runDrain(drain: Drain): Promise<void> {
    const cutoff = drain.revokedAt === null ? null : Date.parse(drain.revokedAt);
    const sendable = (e: OutboxEntry) =>
      matchesScope(e, drain) && (cutoff === null || Date.parse(e.clientAt) < cutoff);

    if (this.clock.now() < drain.until) {
      await this.pushWhere(sendable, true, drain.grant);
      const left = (await this.store.listOutbox({ status: 'pending' })).filter(sendable);
      if (left.length > 0) return;
    }

    const unsent = (await this.store.listOutbox()).filter(
      (e) => e.status !== 'pending_review' && matchesScope(e, drain),
    );
    const discarded = countByType(unsent);
    if (drain.projectId === null) {
      await this.store.wipe();
      this.phase = 'wiped';
    } else {
      await this.store.purgeScope({ projectId: drain.projectId, module: drain.module });
    }
    this.drains = this.drains.filter((d) => d !== drain);
    this.emit({
      type: 'purged',
      scope: drain.projectId === null ? null : { projectId: drain.projectId, module: drain.module },
      discarded,
    });
  }

  private emit(event: SyncEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private async emitStatus() {
    if (this.listeners.size === 0) return;
    this.emit({ type: 'status', status: await this.status() });
  }
}
