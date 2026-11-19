'use client';

import type { InjuryCount } from '../lib/types';

/** Horizontal bars, one row per category, each in its own colour; the label and number are always shown. */
export function BarList({
  items,
  label,
  colour,
  empty = 'No injuries recorded.',
}: {
  items: readonly InjuryCount[];
  label: (key: string) => string;
  colour: (key: string) => string;
  empty?: string;
}) {
  if (items.length === 0) return <p className="u-muted u-m-0">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="ia-bars">
      {items.map((i) => (
        <li key={i.key} className="ia-bars__row">
          <span className="ia-bars__label">{label(i.key)}</span>
          <span className="ia-bars__track" aria-hidden="true">
            <span
              className="ia-bars__fill"
              style={{
                width: `${(i.count / max) * 100}%`,
                background: colour(i.key),
                display: 'block',
              }}
            />
          </span>
          <span className="ia-bars__value">{i.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** Donut with a legend. Categories past `limit` fold into one grey "Other". */
export function Donut({
  items,
  label,
  colour,
  limit = 7,
  empty = 'No injuries recorded.',
}: {
  items: readonly InjuryCount[];
  label: (key: string) => string;
  colour: (key: string) => string;
  limit?: number;
  empty?: string;
}) {
  const total = items.reduce((n, i) => n + i.count, 0);
  if (total === 0) return <p className="u-muted u-m-0">{empty}</p>;
  const colourOf = (k: string) => colour(k);
  const grey = 'var(--ia-other)';
  const named = items.filter((i) => colourOf(i.key) !== grey).slice(0, limit);
  const otherCount = total - named.reduce((n, i) => n + i.count, 0);
  const slices = [
    ...named.map((i) => ({
      key: i.key,
      name: label(i.key),
      count: i.count,
      fill: colourOf(i.key),
    })),
    ...(otherCount > 0 ? [{ key: '_other', name: 'Other', count: otherCount, fill: grey }] : []),
  ];
  let offset = 0;
  return (
    <div className="ia-donut">
      <svg viewBox="0 0 42 42" role="img" aria-label={`${total} injuries by category`}>
        {slices.map((s) => {
          const pct = (s.count / total) * 100;
          const el = (
            <circle
              key={s.key}
              cx="21"
              cy="21"
              r="15.915"
              fill="none"
              stroke={s.fill}
              strokeWidth="7"
              pathLength={100}
              strokeDasharray={`${Math.max(0, pct - (slices.length > 1 ? 0.8 : 0))} ${100 - pct + (slices.length > 1 ? 0.8 : 0)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 21 21)"
            >
              <title>{`${s.name}: ${s.count}`}</title>
            </circle>
          );
          offset += pct;
          return el;
        })}
        <text x="21" y="22.5" textAnchor="middle" fontSize="7" fill="var(--c-text)">
          {total}
        </text>
      </svg>
      <ul className="ia-legend">
        {slices.map((s) => (
          <li key={s.key} className="ia-legend__item">
            <span className="ia-legend__dot" style={{ background: s.fill }} aria-hidden="true" />
            {s.name}
            <span className="ia-legend__count">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One segmented bar split by outcome, with the legend underneath. */
export function StackBar({
  items,
  label,
  colour,
}: {
  items: readonly InjuryCount[];
  label: (key: string) => string;
  colour: (key: string) => string;
}) {
  const total = items.reduce((n, i) => n + i.count, 0);
  if (total === 0) return <p className="u-muted u-m-0">No injuries recorded.</p>;
  return (
    <div>
      <div className="ia-stack" role="img" aria-label="Injuries by outcome">
        {items.map((i) => (
          <span
            key={i.key}
            style={{ flex: i.count, background: colour(i.key) }}
            title={`${label(i.key)}: ${i.count}`}
          />
        ))}
      </div>
      <ul className="ia-legend">
        {items.map((i) => (
          <li key={i.key} className="ia-legend__item">
            <span
              className="ia-legend__dot"
              style={{ background: colour(i.key) }}
              aria-hidden="true"
            />
            {label(i.key)}
            <span className="ia-legend__count">{i.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Half-circle gauge for "days without". `value` null means nothing has ever been recorded. */
export function DaysGauge({
  title,
  value,
  target = 365,
  noneText,
}: {
  title: string;
  value: number | null;
  target?: number;
  noneText: string;
}) {
  const pct = value === null ? 100 : Math.min(100, (value / target) * 100);
  const colour =
    value === null || value >= 30
      ? 'var(--ia-good)'
      : value >= 7
        ? 'var(--ia-warning)'
        : 'var(--ia-critical)';
  const arc = 'M20 100 A80 80 0 0 1 180 100';
  return (
    <div className="ia-gauge">
      <svg viewBox="0 0 200 110" role="img" aria-label={`${title}: ${value ?? noneText}`}>
        <path d={arc} fill="none" stroke="var(--ia-grid)" strokeWidth="16" pathLength={100} />
        <path
          d={arc}
          fill="none"
          stroke={colour}
          strokeWidth="16"
          pathLength={100}
          strokeDasharray={`${pct} 100`}
        />
      </svg>
      <p className="ia-gauge__value">{value ?? '—'}</p>
      <p className="ia-gauge__label">{value === null ? noneText : title}</p>
    </div>
  );
}
