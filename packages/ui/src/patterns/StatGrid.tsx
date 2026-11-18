import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export type StatTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
  /** Colours the figure and its edge. Use it only when the number means something (for example, more than 0 critical). */
  tone?: StatTone;
  /** Small line under the figure. */
  hint?: ReactNode;
}

/** A row of summary figures. Wraps to as many columns as fit, so it never needs a long vertical list. */
export function StatGrid({ items }: { items: readonly StatItem[] }) {
  return (
    <dl className="ac-stats">
      {items.map((item, i) => (
        <div key={i} className={cx('ac-stat', `ac-stat--${item.tone ?? 'neutral'}`)}>
          <dt className="ac-stat__label">{item.label}</dt>
          <dd className="ac-stat__value">{item.value}</dd>
          {item.hint ? <dd className="ac-stat__hint">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
