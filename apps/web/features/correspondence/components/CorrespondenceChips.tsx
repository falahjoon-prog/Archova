import { StatusPill } from '@archova/ui';
import { formatLocalDate } from '@/shared/lib/format';
import { STATUS_LABELS, STATUS_TONES, type CorrespondenceItem } from '../lib/types';

export function CorrespondenceStatusPill({ status }: { status: CorrespondenceItem['status'] }) {
  return <StatusPill tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</StatusPill>;
}

/** SCH-AC4: the last day to give the notice while it is a draft; amber within 3 business days, red within 1. */
export function TimeBar({
  item,
}: {
  item: Pick<CorrespondenceItem, 'timeBarDate' | 'timeBarState' | 'sentInTime'>;
}) {
  if (!item.timeBarDate) return <span className="u-muted">—</span>;
  const date = formatLocalDate(item.timeBarDate);
  if (item.timeBarState === 'overdue')
    return <StatusPill tone="danger">Overdue · {date}</StatusPill>;
  if (item.timeBarState === 'red') return <StatusPill tone="danger">Due · {date}</StatusPill>;
  if (item.timeBarState === 'amber')
    return <StatusPill tone="warning">Due soon · {date}</StatusPill>;
  if (item.sentInTime === false) return <StatusPill tone="warning">Sent late · {date}</StatusPill>;
  return <span>{date}</span>;
}
