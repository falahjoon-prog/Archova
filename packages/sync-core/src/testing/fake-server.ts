// A fake of the sync endpoints (backend 04 §4) for deterministic tests of the engine and of app features
// built on it. Commands are declared with how they change a record; the fake keeps a change feed, checks
// base versions, revokes access and holds drain pushes for review like the real API.

import { SyncHttpError, type SyncTransport } from '../transport';
import type {
  PullChange,
  PullRequest,
  PullResponse,
  PushMutation,
  PushRequest,
  PushResponse,
  PushResult,
  RevokedScope,
  SyncScope,
} from '../wire';

export interface FakeCommand {
  entityType: string;
  module: string;
  /** create: new record; update: merge payload, version-checked; append: never conflicts; delete. */
  kind: 'create' | 'update' | 'append' | 'delete';
}

export interface FakeRecord {
  entityType: string;
  id: string;
  version: number;
  projectId: string;
  module: string;
  data: Record<string, unknown> | null;
}

interface FeedRow {
  seq: number;
  entityType: string;
  id: string;
}

export class FakeSyncServer {
  readonly records = new Map<string, FakeRecord>();
  /** Mutation ids already applied, with their result, so retries are idempotent. */
  readonly applied = new Map<string, PushResult>();
  /** Drain pushes held for an admin (`shared.late_submissions`). */
  readonly lateSubmissions: PushMutation[] = [];
  readonly pushLog: { mutations: PushMutation[]; drain: boolean }[] = [];
  readonly pullLog: PullRequest[] = [];

  /** Records whose file the scan has not cleared: `file.not_ready` (retry) or `file.blocked` (final). */
  private fileProblems = new Map<string, 'file.not_ready' | 'file.blocked'>();
  private feed: FeedRow[] = [];
  private seq = 0;
  private revoked: RevokedScope[] = [];
  private accessEndedAt: string | null = null;
  private failures: SyncHttpError[] = [];
  private readonly commands: Record<string, FakeCommand>;

  constructor(commands: Record<string, FakeCommand>) {
    this.commands = commands;
  }

  /** Answer commands on this entity with a file problem until it is cleared with `null`. */
  setFileProblem(entityId: string, code: 'file.not_ready' | 'file.blocked' | null) {
    if (code) this.fileProblems.set(entityId, code);
    else this.fileProblems.delete(entityId);
  }

  /** Make the next `count` requests fail with this error (status 0 is "offline"). */
  failNext(count: number, error: SyncHttpError = new SyncHttpError(0)) {
    for (let i = 0; i < count; i++) this.failures.push(error);
  }

  /** The network is fine again: drop failures queued with failNext that no request consumed. */
  clearFailures() {
    this.failures = [];
  }

  /** Another user changes a record on the server. */
  serverWrite(record: Omit<FakeRecord, 'version'>): FakeRecord {
    const existing = this.records.get(key(record.entityType, record.id));
    const next: FakeRecord = { ...record, version: (existing?.version ?? 0) + 1 };
    this.records.set(key(record.entityType, record.id), next);
    this.append(record.entityType, record.id);
    return next;
  }

  serverDelete(entityType: string, id: string) {
    const existing = this.records.get(key(entityType, id));
    if (!existing) return;
    this.records.set(key(entityType, id), {
      ...existing,
      version: existing.version + 1,
      data: null,
    });
    this.append(entityType, id);
  }

  revoke(scope: RevokedScope) {
    this.revoked.push(scope);
  }

  /** The user's access to the organisation ended; pushes must use the drain grant from now on. */
  endAccess(at: string) {
    this.accessEndedAt = at;
  }

  transport(): SyncTransport {
    return {
      pull: async (request) => this.pull(request),
      push: async (request, options) => this.push(request, options),
    };
  }

  async pull(request: PullRequest): Promise<PullResponse> {
    this.takeFailure();
    if (this.accessEndedAt) throw new SyncHttpError(401, { code: 'access.revoked' });
    this.pullLog.push(structuredClone(request));
    const since = Number(request.since);
    const visible = (r: FakeRecord) =>
      request.scopes.some(
        (s: SyncScope) =>
          s.kind === 'project' && s.projectId === r.projectId && s.module === r.module,
      ) && !this.isRevoked(r.projectId, r.module);

    const rows = this.feed.filter((row) => row.seq > since);
    const page = rows.slice(0, request.limit);
    const latest = new Map<string, PullChange>();
    for (const row of page) {
      const record = this.records.get(key(row.entityType, row.id));
      if (!record || !visible(record)) continue;
      latest.set(
        key(row.entityType, row.id),
        record.data === null
          ? { entityType: record.entityType, id: record.id, op: 'delete', version: record.version }
          : {
              entityType: record.entityType,
              id: record.id,
              op: 'upsert',
              version: record.version,
              data: structuredClone(record.data),
            },
      );
    }
    const last = page.at(-1);
    return {
      changes: [...latest.values()],
      revokedScopes: this.revoked.filter((r) =>
        request.scopes.some(
          (s) =>
            s.kind === 'project' &&
            s.projectId === r.projectId &&
            (r.module === null || r.module === s.module),
        ),
      ),
      nextSince: String(last ? last.seq : since),
      hasMore: rows.length > page.length,
    };
  }

  async push(request: PushRequest, options: { drain: boolean }): Promise<PushResponse> {
    this.takeFailure();
    if (this.accessEndedAt && !options.drain)
      throw new SyncHttpError(401, { code: 'access.revoked' });
    this.pushLog.push({ mutations: structuredClone(request.mutations), drain: options.drain });
    if (request.mutations.length > 100) throw new SyncHttpError(400, { code: 'batch.too_large' });
    return { results: request.mutations.map((m) => this.applyOne(m, options.drain)) };
  }

  private applyOne(m: PushMutation, drain: boolean): PushResult {
    const done = this.applied.get(m.mutationId);
    if (done) return done;
    const command = this.commands[m.command];
    if (!command)
      return this.remember(m, { status: 'rejected', problem: { code: 'unknown-command' } });
    const payload = (m.payload ?? {}) as Record<string, unknown>;
    const projectId = String(payload.projectId ?? '');
    const fileProblem = this.fileProblems.get(m.entityId);
    if (fileProblem === 'file.not_ready') {
      // Not remembered: the same mutation is sent again once the scan finishes.
      return { mutationId: m.mutationId, status: 'rejected', problem: { code: fileProblem } };
    }
    if (fileProblem)
      return this.remember(m, { status: 'rejected', problem: { code: fileProblem } });

    if (drain) {
      const ended = this.accessEndedAt;
      if (ended !== null && Date.parse(m.clientAt) >= Date.parse(ended)) {
        return this.remember(m, { status: 'rejected', problem: { code: 'access.revoked' } });
      }
      this.lateSubmissions.push(structuredClone(m));
      return this.remember(m, { status: 'pending_review' });
    }
    if (this.isRevoked(projectId, command.module)) {
      // Not remembered: the device re-sends the same mutation with the drain grant (X38).
      return { mutationId: m.mutationId, status: 'rejected', problem: { code: 'access.revoked' } };
    }

    const k = key(command.entityType, m.entityId);
    const existing = this.records.get(k);
    if (command.kind === 'create' || command.kind === 'append') {
      if (existing) return this.remember(m, { status: 'applied', version: existing.version });
      const record = this.serverWrite({
        entityType: command.entityType,
        id: m.entityId,
        projectId,
        module: command.module,
        data: { ...payload },
      });
      return this.remember(m, { status: 'applied', version: record.version });
    }
    if (!existing || existing.data === null) {
      return this.remember(m, { status: 'rejected', problem: { code: 'not-found' } });
    }
    if (m.baseVersion !== existing.version) {
      return this.remember(m, {
        status: 'conflict',
        version: existing.version,
        server: structuredClone(existing.data),
      });
    }
    if (command.kind === 'delete') {
      this.serverDelete(command.entityType, m.entityId);
      return this.remember(m, { status: 'applied', version: existing.version + 1 });
    }
    const record = this.serverWrite({ ...existing, data: { ...existing.data, ...payload } });
    return this.remember(m, { status: 'applied', version: record.version });
  }

  private remember(
    m: PushMutation,
    result: DistributiveOmit<PushResult, 'mutationId'>,
  ): PushResult {
    const full = { ...result, mutationId: m.mutationId } as PushResult;
    this.applied.set(m.mutationId, full);
    return full;
  }

  private isRevoked(projectId: string, module: string) {
    return this.revoked.some(
      (r) => r.projectId === projectId && (r.module === null || r.module === module),
    );
  }

  private append(entityType: string, id: string) {
    this.feed.push({ seq: ++this.seq, entityType, id });
  }

  private takeFailure() {
    const failure = this.failures.shift();
    if (failure) throw failure;
  }
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

const key = (entityType: string, id: string) => `${entityType}:${id}`;
