// Offline sync engine shared by mobile (and web later): device outbox, pull loop, conflict handling (ADR-0006).
// Phase 0 fixes the wire types from api.md §7 and clients.md §3; Mia builds the engine in phase 1.

/** A pull scope: `project:{projectId}:{module}` (api.md §7). */
export type SyncScope = `project:${string}:${string}`;

export interface PullChange {
  module: string;
  entityType: string;
  entityId: string;
  op: 'upsert' | 'delete';
  version: number | null;
  data?: unknown;
}

export interface PullResponse {
  changes: PullChange[];
  checkpoint: string;
  hasMore: boolean;
  /** Scopes the user lost access to; the device purges that data (X14). */
  revokedScopes: string[];
}

export interface PushMutation {
  idempotencyKey: string;
  entityType: string;
  entityId: string;
  op: 'create' | 'update' | 'delete';
  baseVersion: number | null;
  clientTimestamp: string;
  data: unknown;
}

export type PushResult =
  | { idempotencyKey: string; status: 'applied'; version: number }
  | { idempotencyKey: string; status: 'conflict'; server: unknown }
  | { idempotencyKey: string; status: 'rejected'; code: string };

export function scope(projectId: string, module: string): SyncScope {
  return `project:${projectId}:${module}`;
}
