import { StatusPill } from '@archova/ui';

/** "Rev C (current)" vs "Rev B (superseded)" (design 02 §7.6). */
export function RevisionBadge({ rev, status }: { rev: string; status: 'current' | 'superseded' }) {
  return status === 'current' ? (
    <StatusPill tone="success">Rev {rev} (current)</StatusPill>
  ) : (
    <StatusPill tone="neutral">Rev {rev} (superseded)</StatusPill>
  );
}
