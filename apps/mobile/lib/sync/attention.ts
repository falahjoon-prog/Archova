// Plain-language text for an outbox entry the server could not apply ("Needs attention", mobile 02 §2.4).

import type { OutboxEntry } from '@archova/sync-core';

const COMMAND_LABEL: Record<string, string> = {
  'defects.create': 'New defect',
  'defects.assign': 'Defect assignment',
  'defects.markReadyForReview': 'Defect marked ready for review',
  'defects.close': 'Defect closed',
  'photos.create': 'Photo',
  'comments.add': 'Comment',
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
