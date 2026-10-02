// In-memory SyncStore: the reference behaviour the SQLite store in apps/mobile must match, and the store
// the engine tests run against. Records are kept as opaque DTOs keyed by entity type and id.

import {
  commandModule,
  type AttentionReason,
  type NewOutboxEntry,
  type OutboxEntry,
  type OutboxStatus,
  type SyncStore,
  type WipeCounts,
} from './store';
import type { PullChange, PushResult, RevokedScope } from './wire';

export interface LocalRecord {
  entityType: string;
  id: string;
  /** Last version the server confirmed; null for a record created on this device and not yet applied. */
  version: number | null;
  data: unknown;
  /** True while queued work on this record is unsent or unanswered. */
  pending: boolean;
  /** The server's copy, restored when the server refuses a local change. */
  server: { version: number; data: unknown } | null;
}

export interface MemorySyncStoreOptions {
  /** Module an entity type belongs to, for purging a revoked module (`defect` → `defects`). */
  moduleOf?: (entityType: string) => string;
}

const recordKey = (entityType: string, id: string) => `${entityType}:${id}`;

function projectIdOf(data: unknown): string | null {
  if (data && typeof data === 'object' && 'projectId' in data) {
    const value = (data as { projectId: unknown }).projectId;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

export class MemorySyncStore implements SyncStore {
  readonly records = new Map<string, LocalRecord>();
  private outbox: OutboxEntry[] = [];
  private checkpoints = new Map<string, string>();
  private nextSeq = 1;
  private readonly moduleOf: (entityType: string) => string;

  constructor(options: MemorySyncStoreOptions = {}) {
    this.moduleOf = options.moduleOf ?? ((t) => `${t}s`);
  }

  /** A feature's optimistic write plus its outbox entry, as one step (02 §2.4 step 1). */
  async write(
    record: { entityType: string; id: string; data: unknown },
    entry: Omit<NewOutboxEntry, 'entityType' | 'entityId'>,
  ): Promise<OutboxEntry> {
    const key = recordKey(record.entityType, record.id);
    const existing = this.records.get(key);
    this.records.set(key, {
      entityType: record.entityType,
      id: record.id,
      version: existing?.version ?? null,
      data: record.data,
      pending: true,
      server: existing?.server ?? null,
    });
    return this.enqueue({ ...entry, entityType: record.entityType, entityId: record.id });
  }

  get(entityType: string, id: string): LocalRecord | undefined {
    return this.records.get(recordKey(entityType, id));
  }

  async enqueue(entry: NewOutboxEntry, options: { held?: boolean } = {}): Promise<OutboxEntry> {
    const full: OutboxEntry = {
      ...entry,
      dependsOn: [...entry.dependsOn],
      seq: this.nextSeq++,
      status: options.held ? 'held' : 'pending',
      attempts: 0,
    };
    this.outbox.push(full);
    return { ...full };
  }

  async release(mutationId: string, payloadPatch: Record<string, unknown>): Promise<void> {
    const entry = this.outbox.find((e) => e.mutationId === mutationId && e.status === 'held');
    if (!entry) return;
    entry.status = 'pending';
    entry.payload = { ...(entry.payload as object), ...payloadPatch };
  }

  async listOutbox(filter: { status?: OutboxStatus } = {}): Promise<OutboxEntry[]> {
    return this.outbox
      .filter((e) => filter.status === undefined || e.status === filter.status)
      .map((e) => ({ ...e }));
  }

  async recordPushResults(results: PushResult[]): Promise<void> {
    for (const result of results) {
      const entry = this.outbox.find((e) => e.mutationId === result.mutationId);
      if (!entry) continue;
      const record = this.records.get(recordKey(entry.entityType, entry.entityId));
      switch (result.status) {
        case 'applied':
          this.outbox = this.outbox.filter((e) => e !== entry);
          for (const later of this.outbox) {
            if (
              (later.status === 'pending' || later.status === 'held') &&
              later.entityType === entry.entityType &&
              later.entityId === entry.entityId &&
              later.baseVersion === entry.baseVersion
            ) {
              later.baseVersion = result.version;
            }
          }
          if (record) {
            record.version = result.version;
            record.server = { version: result.version, data: record.data };
          }
          break;
        case 'conflict':
          entry.status = 'needs_attention';
          entry.attention = { kind: 'conflict', server: result.server };
          if (record) {
            const version = result.version ?? record.server?.version ?? record.version ?? 0;
            record.data = result.server;
            record.version = version;
            record.server = { version, data: result.server };
          }
          break;
        case 'rejected':
          entry.status = 'needs_attention';
          entry.attention = { kind: 'rejected', problem: result.problem };
          this.revert(entry);
          break;
        case 'pending_review':
          entry.status = 'pending_review';
          break;
      }
      this.refreshPending(entry.entityType, entry.entityId);
    }
  }

  async markNeedsAttention(items: { mutationId: string; reason: AttentionReason }[]) {
    for (const item of items) {
      const entry = this.outbox.find((e) => e.mutationId === item.mutationId);
      if (!entry) continue;
      entry.status = 'needs_attention';
      entry.attention = item.reason;
      this.revert(entry);
      this.refreshPending(entry.entityType, entry.entityId);
    }
  }

  async recordAttempt(mutationIds: string[]): Promise<void> {
    for (const e of this.outbox) if (mutationIds.includes(e.mutationId)) e.attempts++;
  }

  async removeEntries(mutationIds: string[]): Promise<void> {
    const removed = this.outbox.filter((e) => mutationIds.includes(e.mutationId));
    this.outbox = this.outbox.filter((e) => !mutationIds.includes(e.mutationId));
    for (const e of removed) this.refreshPending(e.entityType, e.entityId);
  }

  async getCheckpoints(scopeKeys: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const key of scopeKeys) {
      const value = this.checkpoints.get(key);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  async applyPull(page: { changes: PullChange[]; scopeKeys: string[]; nextSince: string }) {
    for (const change of page.changes) {
      const key = recordKey(change.entityType, change.id);
      const existing = this.records.get(key);
      const server = change.op === 'delete' ? null : { version: change.version, data: change.data };
      if (existing?.pending) {
        // Unsent local work wins on screen until the server answers it.
        existing.server = server;
        continue;
      }
      if (change.op === 'delete') {
        this.records.delete(key);
      } else {
        this.records.set(key, {
          entityType: change.entityType,
          id: change.id,
          version: change.version,
          data: change.data,
          pending: false,
          server,
        });
      }
    }
    for (const scopeKey of page.scopeKeys) this.checkpoints.set(scopeKey, page.nextSince);
  }

  async purgeScope(scope: RevokedScope): Promise<WipeCounts> {
    const inScope = (projectId: string | null, module: string) =>
      projectId === scope.projectId && (scope.module === null || scope.module === module);
    const dropped = this.outbox.filter(
      (e) => e.status !== 'pending_review' && inScope(e.projectId, commandModule(e.command)),
    );
    this.outbox = this.outbox.filter((e) => !inScope(e.projectId, commandModule(e.command)));
    for (const [key, record] of this.records) {
      const data = record.data ?? record.server?.data;
      if (inScope(projectIdOf(data), this.moduleOf(record.entityType))) this.records.delete(key);
    }
    const prefix =
      scope.module === null
        ? `project:${scope.projectId}:`
        : `project:${scope.projectId}:${scope.module}`;
    for (const key of [...this.checkpoints.keys()]) {
      if (scope.module === null ? key.startsWith(prefix) : key === prefix)
        this.checkpoints.delete(key);
    }
    return countByType(dropped);
  }

  async wipe(): Promise<WipeCounts> {
    const dropped = this.outbox.filter((e) => e.status !== 'pending_review');
    this.records.clear();
    this.outbox = [];
    this.checkpoints.clear();
    return countByType(dropped);
  }

  /**
   * Undo a refused optimistic change: back to the server copy, or gone if the server never had it.
   * While other queued work on the record is still unanswered the local copy stays, since it includes that
   * work; the next pull after it is answered corrects the record.
   */
  private revert(entry: OutboxEntry) {
    const key = recordKey(entry.entityType, entry.entityId);
    const record = this.records.get(key);
    if (!record) return;
    const othersPending = this.outbox.some(
      (e) =>
        e !== entry &&
        e.entityType === entry.entityType &&
        e.entityId === entry.entityId &&
        (e.status === 'pending' || e.status === 'held'),
    );
    if (othersPending) return;
    if (record.server) {
      record.data = record.server.data;
      record.version = record.server.version;
    } else {
      this.records.delete(key);
    }
  }

  private refreshPending(entityType: string, entityId: string) {
    const record = this.records.get(recordKey(entityType, entityId));
    if (!record) return;
    record.pending = this.outbox.some(
      (e) =>
        e.entityType === entityType &&
        e.entityId === entityId &&
        (e.status === 'pending' || e.status === 'held' || e.status === 'pending_review'),
    );
  }
}

function countByType(entries: OutboxEntry[]): WipeCounts {
  const counts: WipeCounts = {};
  for (const e of entries) counts[e.entityType] = (counts[e.entityType] ?? 0) + 1;
  return counts;
}
