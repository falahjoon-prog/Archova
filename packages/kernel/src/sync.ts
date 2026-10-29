import type { TenantScope } from './db';

/**
 * What a module offers the mobile pull (backend 04 §4). The sync module reads `shared.change_feed` and asks the
 * source of each changed record's module for the record as the caller may see it.
 */
export interface SyncSource {
  /** `shared.change_feed.module`, and the module name devices ask for in `project:{id}:{module}`. */
  module: string;
  /** Read permission on a project; a caller without it has that module revoked. `null` for org-wide data. */
  permission: string | null;
  /** The id devices see, e.g. `dfx_…`. */
  publicId(entityType: string, id: string): string;
  /**
   * The records the caller can see among `ids` (up to 500), keyed by id, with the same DTO as the REST endpoints.
   * Ids missing from the result were deleted or are not visible to the caller (company scoping, privacy), and are
   * sent to the device as deletes.
   */
  load(
    scope: TenantScope,
    request: { projectId: string | null; entityType: string; ids: readonly string[] },
  ): Promise<Map<string, { version: number; data: Record<string, unknown> }>>;
}

/** One queued change from a device (backend 04 §4 push), with the entity id as the device knows it. */
export interface SyncMutationInput {
  entityId: string;
  /** The version the change was made against; `null` for a create. */
  baseVersion: number | null;
  clientAt: Date;
  payload: Record<string, unknown>;
  /**
   * Set only when an admin accepts a change that was held after the sender's access ended (X38). The command runs as
   * the admin; this says whose change it is, so the record can show "submitted late by X, accepted by Y".
   * `clientAt` is the device's clock and is not verified.
   */
  late?: { userId: string; clientAt: Date; receivedAt: Date };
}

/**
 * A module use case a device may queue offline (backend 04 §4 push). It runs the same service function as the REST
 * endpoint, so permissions, state machines and audit are identical online and offline. A failed precondition throws
 * `versionConflict()` (reported as a conflict, with `current`) or any other `AppError` (reported as a rejection).
 */
export interface SyncCommand {
  /** `module.useCase`, e.g. `defects.transition`. */
  name: string;
  /** Whose licence the command needs: the same module the REST endpoint is under. */
  module: string;
  /**
   * True when a person whose access just ended may still send it with a drain grant (X38). The server then only
   * queues it for an admin and never runs it, so it is set for commands whose late result is worth reviewing.
   */
  drainable?: boolean;
  /**
   * The project the entity really belongs to, read from the record. Required for a `drainable` command: the project
   * a device sends with a drain grant is its own claim, and the accept step checks it against this.
   */
  projectOf?(scope: TenantScope, entityId: string): Promise<string | null>;
  run(scope: TenantScope, mutation: SyncMutationInput): Promise<{ version: number }>;
  /** The caller's current copy of the record, for a conflict result; null when it is gone or not visible. */
  current(
    scope: TenantScope,
    entityId: string,
  ): Promise<{ version: number; data: Record<string, unknown> } | null>;
}
