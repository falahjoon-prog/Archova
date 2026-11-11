import { StatusPill } from '@archova/ui';
import { FLAG_LABELS, type SubmissionFlag } from '../lib/types';

const TONE = { overdue: 'danger', due_soon: 'warning', stale: 'warning' } as const;

/** Nova's flags on an open form, with how late it is when it is. */
export function FlagPills({ flags, daysLate }: { flags: SubmissionFlag[]; daysLate: number }) {
  return (
    <>
      {flags.map((f) => (
        <StatusPill key={f} tone={TONE[f]}>
          {f === 'overdue' && daysLate > 0 ? `Overdue ${daysLate}d` : FLAG_LABELS[f]}
        </StatusPill>
      ))}
    </>
  );
}
