// Plain-language text for an outbox entry the server could not apply ("Needs attention", mobile 02 §2.4).

import type { OutboxEntry, SyncStore } from '@archova/sync-core';

const COMMAND_LABEL: Record<string, string> = {
  'defects.create': 'New defect',
  'defects.assign': 'Defect assignment',
  'defects.markReadyForReview': 'Defect marked ready for review',
  'defects.close': 'Defect closed',
  'photos.create': 'Photo',
  'drawings.createMarkup': 'Drawing markup',
  'drawings.updateMarkup': 'Drawing markup change',
  'drawings.deleteMarkup': 'Drawing markup deleted',
  'comments.add': 'Comment',
  'quality.recordResponses': 'Inspection answer',
  'quality.submit': 'Inspection submitted',
};

export function commandLabel(command: string): string {
  if (COMMAND_LABEL[command]) return COMMAND_LABEL[command];
  if (command.startsWith('diary.')) return 'Site diary change';
  const [module = command] = command.split('.');
  return `${module.charAt(0).toUpperCase()}${module.slice(1)} change`;
}

export function attentionReason(entry: OutboxEntry): string {
  const reason = entry.attention;
  switch (reason?.kind) {
    case 'conflict':
      return 'Someone else changed this. Your change was not applied.';
    case 'rejected':
      return reason.problem.code === 'module_not_licensed'
        ? 'Your organisation is not licensed for this module.'
        : (reason.problem.detail ?? 'The server did not accept this change.');
    case 'dependency_failed':
      return 'It depends on another change that was not applied.';
    case 'access_revoked':
      return 'You no longer have access to this project.';
    default:
      return 'This change needs a look.';
  }
}

/** "12 KB", "3.4 MB": decimal units, one decimal from MB up. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/** Whether the user can try the change again: not when access to the project is gone. */
export function canReapply(entry: OutboxEntry): boolean {
  return entry.attention?.kind !== 'access_revoked';
}

/**
 * Queue each entry again as a new command (fresh mutation id and idempotency key) and drop the old ones, in one
 * pass in queue order. The base version is the record's current version, which after a conflict is the server's
 * copy, so the retry is judged against what is there now. Commands that waited on a reapplied parent wait on its
 * new id. The optimistic change was reverted when the server answered; the result appears after the next pull.
 */
export async function reapplyEntries(
  store: Pick<SyncStore, 'enqueue' | 'removeEntries'> & {
    get(entityType: string, id: string): Promise<{ version: number | null } | undefined>;
  },
  entries: readonly OutboxEntry[],
  newId: () => string,
): Promise<{ reapplied: number }> {
  const idMap = new Map<string, string>();
  const done: string[] = [];
  for (const e of [...entries].filter(canReapply).sort((a, b) => a.seq - b.seq)) {
    const current = await store.get(e.entityType, e.entityId);
    const mutationId = newId();
    await store.enqueue({
      mutationId,
      command: e.command,
      entityType: e.entityType,
      entityId: e.entityId,
      projectId: e.projectId,
      baseVersion: current?.version ?? e.baseVersion,
      clientAt: e.clientAt,
      payload: e.payload,
      dependsOn: e.dependsOn.map((d) => idMap.get(d) ?? d),
    });
    idMap.set(e.mutationId, mutationId);
    done.push(e.mutationId);
  }
  await store.removeEntries(done);
  return { reapplied: done.length };
}
