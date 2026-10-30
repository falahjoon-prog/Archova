// Wire types for the mobile sync endpoints (api.md §7, backend 04 §4). These follow Ben's request and
// response shapes; when the endpoints land in packages/contracts/openapi, the generated types replace
// these and this file re-exports them.

/** One sync scope: a module of a project, or the organisation-wide data (companies, people, entitlements). */
export type SyncScope = { kind: 'project'; projectId: string; module: string } | { kind: 'org' };

export function projectScope(projectId: string, module: string): SyncScope {
  return { kind: 'project', projectId, module };
}

export const ORG_SCOPE: SyncScope = { kind: 'org' };

/** Stable key for a scope, used for checkpoints: `project:{projectId}:{module}` or `org`. */
export function scopeKey(scope: SyncScope): string {
  return scope.kind === 'org' ? 'org' : `project:${scope.projectId}:${scope.module}`;
}

export function parseScopeKey(key: string): SyncScope {
  if (key === 'org') return ORG_SCOPE;
  const match = /^project:([^:]+):([^:,;]+)$/.exec(key);
  if (!match) throw new Error(`Invalid sync scope key: ${key}`);
  return projectScope(match[1]!, match[2]!);
}

/**
 * The `scopes` query parameter: modules of one project share a segment, segments are separated by `;`.
 * `[defects of A, diary of A, org]` → `project:A:defects,diary;org`.
 */
export function formatScopesParam(scopes: readonly SyncScope[]): string {
  const byProject = new Map<string, Set<string>>();
  let org = false;
  for (const s of scopes) {
    if (s.kind === 'org') {
      org = true;
      continue;
    }
    const modules = byProject.get(s.projectId) ?? new Set<string>();
    modules.add(s.module);
    byProject.set(s.projectId, modules);
  }
  const segments = [...byProject].map(([id, modules]) => `project:${id}:${[...modules].join(',')}`);
  if (org) segments.push('org');
  return segments.join(';');
}

export interface PullChange {
  entityType: string;
  id: string;
  op: 'upsert' | 'delete';
  version: number;
  /** The record's DTO; absent on deletes. */
  data?: unknown;
}

/**
 * Drain-only grant (X38): lets the device push work queued before access ended. The token is shown once and
 * each new one replaces the last, so the device keeps the first per scope and stops pulling a lost project.
 */
export interface DrainGrant {
  token: string;
  expiresAt: string;
  orgId: string;
  projectId: string | null;
  module: string | null;
}

/** Access the caller lost. `module: null` means the whole project (X14). */
export interface RevokedScope {
  projectId: string;
  module: string | null;
  /** Present once, when the scope was revoked after the device last pulled. */
  drainGrant?: DrainGrant;
}

export interface PullRequest {
  scopes: SyncScope[];
  since: string;
  limit: number;
}

export interface PullResponse {
  changes: PullChange[];
  revokedScopes: RevokedScope[];
  nextSince: string;
  hasMore: boolean;
}

export interface PushMutation {
  /** UUIDv7, also the idempotency key. */
  mutationId: string;
  /** A module use case, for example `defects.markReadyForReview`. */
  command: string;
  entityId: string;
  /** Required when sending with a drain grant: the server checks it against the grant (X38). */
  projectId?: string;
  baseVersion: number | null;
  /** When the user made the change on the device (ISO 8601 instant). Evidential records keep it (AC21). */
  clientAt: string;
  payload: unknown;
}

export interface PushRequest {
  mutations: PushMutation[];
}

export interface SyncProblem {
  code: string;
  detail?: string;
  /** On `access.revoked` when only a project or module was revoked. */
  drainGrant?: DrainGrant;
}

export type PushResult =
  | { mutationId: string; status: 'applied'; version: number }
  | { mutationId: string; status: 'conflict'; version?: number; server: unknown }
  | { mutationId: string; status: 'rejected'; problem: SyncProblem }
  /** Sent in drain mode after access ended; held for an admin to accept or reject (X38). */
  | { mutationId: string; status: 'pending_review' };

export interface PushResponse {
  results: PushResult[];
}

/** Server caps (backend 04 §4). */
export const MAX_PUSH_BATCH = 100;
export const DEFAULT_PULL_LIMIT = 500;
