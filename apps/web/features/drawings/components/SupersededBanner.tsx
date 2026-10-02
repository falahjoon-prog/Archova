import Link from 'next/link';
import { Alert } from '@archova/ui';
import type { DrawingRevision } from '../lib/types';

/**
 * DOC-AC6: opening a superseded revision always shows a red banner naming the newer revision and when it took
 * over, with a link to the current one. It can't be dismissed.
 */
export function SupersededBanner({
  revision,
  currentHref,
  formatDate,
}: {
  revision: DrawingRevision;
  currentHref: string;
  formatDate: (iso: string) => string;
}) {
  if (revision.status !== 'superseded') return null;
  return (
    <Alert
      tone="danger"
      title={`Rev ${revision.rev} is superseded`}
      action={
        <Link className="link" href={currentHref}>
          View current
        </Link>
      }
    >
      Superseded by Rev {revision.supersededByRev ?? '?'}
      {revision.supersededAt ? ` on ${formatDate(revision.supersededAt)}` : ''}. Don&apos;t build
      from this revision.
    </Alert>
  );
}
