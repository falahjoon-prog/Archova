// The engine's view of the device database. The app implements it over encrypted SQLite
// (apps/mobile/lib/db); MemorySyncStore is the reference implementation the tests run against.

import type { PullChange, PushResult, RevokedScope, SyncProblem } from './wire';

export type OutboxStatus =
  /** Waiting to be sent. */
  | 'pending'
  /**
   * Queued but not sendable yet: waiting for its file to reach storage (a photo's `photos.create`). Counts as
   * unsent; anything that depends on it waits too. `release` makes it pending.
   */
  | 'held'
  /** The server could not apply it (conflict, rejected, or its parent failed). Shown under "Needs attention". */
  | 'needs_attention'
  /** Sent after access ended; an admin will accept or reject it (X38). */
  | 'pending_review';

export type AttentionReason =
  | { kind: 'conflict'; server: unknown }
  | { kind: 'rejected'; problem: SyncProblem }
  | { kind: 'dependency_failed'; parentMutationId: string }
  /** The project or module was removed from the user while this was still unsent (02 §2.5). */
  | { kind: 'access_revoked' };

export interface OutboxEntry {
  mutationId: string;
  command: string;
  entityType: string;
  entityId: string;
  /** The project the record belongs to; null for organisation-level commands. */
  projectId: string | null;
  baseVersion: number | null;
  /** ISO 8601 instant the user made the change on the device. */
  clientAt: string;
  payload: unknown;
  /** Mutations that must be applied first (a photo linked to a defect created offline). */
  dependsOn: string[];
  /** Monotonic order in which entries were queued. */
  seq: number;
  status: OutboxStatus;
  attempts: number;
  attention?: AttentionReason;
}

/** Fields a feature supplies when it queues a command; the store assigns `seq`, `status` and `attempts`. */
export type NewOutboxEntry = Omit<OutboxEntry, 'seq' | 'status' | 'attempts' | 'attention'>;

/** The module a command belongs to: `defects.create` → `defects`. */
export function commandModule(command: string): string {
  const dot = command.indexOf('.');
  return dot === -1 ? command : command.slice(0, dot);
}

/** Types and counts only, for `POST /v1/me/devices/{deviceId}/wipe-report` (AC23). */
export type WipeCounts = Record<string, number>;

export interface SyncStore {
  /**
   * Queue a command. Features call this in the same local transaction as their optimistic write
   * (02 §2.4), so the app's implementation joins the caller's transaction.
   */
  enqueue(entry: NewOutboxEntry, options?: { held?: boolean }): Promise<OutboxEntry>;

  /** Make a held entry sendable, merging `payloadPatch` (for example the stored file's id) into its payload. */
  release(mutationId: string, payloadPatch: Record<string, unknown>): Promise<void>;

  /** Entries in queue order, optionally filtered by status. */
  listOutbox(filter?: { status?: OutboxStatus }): Promise<OutboxEntry[]>;

  /**
   * Record the server's answer for each sent mutation, in one transaction:
   * - applied: drop the entry and clear the record's pending flag (the next pull brings the numbered record),
   *   and rebase later queued changes to the same record that were made on top of it (same `baseVersion`)
   *   onto the applied version, so the device's own chain of edits does not conflict with itself;
   * - conflict: revert the local record to the server copy, keep the entry as needs_attention;
   * - rejected: revert the optimistic change, keep the entry as needs_attention;
   * - pending_review: keep the entry, read-only, as pending_review.
   */
  recordPushResults(results: PushResult[]): Promise<void>;

  /** Move entries to needs_attention without sending them (failed parent, revoked access). */
  markNeedsAttention(items: { mutationId: string; reason: AttentionReason }[]): Promise<void>;

  /** Count a failed send attempt (network error, 5xx) against the entries. */
  recordAttempt(mutationIds: string[]): Promise<void>;

  /** Remove entries the user discarded from "Needs attention", or that were reapplied as new entries. */
  removeEntries(mutationIds: string[]): Promise<void>;

  /** Last change feed position pulled per scope key; missing means never pulled. */
  getCheckpoints(scopeKeys: string[]): Promise<Record<string, string>>;

  /**
   * Apply one pulled page and advance the checkpoints of the scopes it was pulled for, atomically.
   * Records with unsent local changes keep their local copy (the pending entry wins until answered).
   */
  applyPull(page: { changes: PullChange[]; scopeKeys: string[]; nextSince: string }): Promise<void>;

  /** Delete the local data and files of a revoked scope, and its checkpoints. Returns what was dropped. */
  purgeScope(scope: RevokedScope): Promise<WipeCounts>;

  /** Delete everything for this organisation (the app deletes the database file). */
  wipe(): Promise<WipeCounts>;
}
