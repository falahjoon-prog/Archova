import { StatusPill } from '@archova/ui';
import type { LocalDate } from '@archova/time';
import { formatLocalDate } from '@/shared/lib/format';
import type { KeyDates } from '../data/api';
import { milestones, type MilestoneState } from '../lib/milestones';

const TONE: Record<MilestoneState, 'success' | 'danger' | 'info' | 'neutral'> = {
  done: 'success',
  late: 'danger',
  next: 'info',
  later: 'neutral',
};
const STATE_LABEL: Record<MilestoneState, string> = {
  done: 'Done',
  late: 'Late',
  next: 'Next',
  later: 'Upcoming',
};

/** Key dates in date order with where each stands against today. Needs two or more dates to be a strip. */
export function MilestoneStrip({ dates, today }: { dates: KeyDates; today: LocalDate }) {
  const items = milestones(dates, today);
  if (items.length < 2) return null;
  return (
    <ol className="milestones" aria-label="Milestones in date order">
      {items.map((m) => (
        <li key={m.id} className={`milestones__item milestones__item--${m.state}`}>
          <span className="milestones__dot" aria-hidden="true" />
          <span className="milestones__label">{m.label}</span>
          <span className="milestones__date">{formatLocalDate(m.date)}</span>
          <StatusPill tone={TONE[m.state]}>
            <span className="ac-visually-hidden">{STATE_LABEL[m.state]}: </span>
            {m.note}
          </StatusPill>
        </li>
      ))}
    </ol>
  );
}
