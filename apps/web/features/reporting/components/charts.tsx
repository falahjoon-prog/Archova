import type { ReactNode } from 'react';

// Chart colours live in globals.css as --chart-* so they stay a fixed, full-colour set in light and dark,
// separate from the slate and amber used for buttons and navigation. Meaning is never colour alone: every
// mark has a text label or a legend entry with its number.

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** CSS colour, normally `var(--chart-…)`. */
  color: string;
}

/** Half-circle gauge for a whole percent; null shows "No data". */
export function Gauge({ percent, label }: { percent: number | null; label: string }) {
  const r = 52;
  const len = Math.PI * r;
  const filled = percent === null ? 0 : (len * percent) / 100;
  const arc = `M ${60 - r} 62 A ${r} ${r} 0 0 1 ${60 + r} 62`;
  return (
    <figure
      className="dbp-gauge"
      aria-label={`${label}: ${percent === null ? 'no data' : `${percent}% passing`}`}
    >
      <svg viewBox="0 0 120 70" role="img" aria-hidden="true">
        <path d={arc} className="dbp-gauge__track" />
        {percent !== null ? (
          <path d={arc} className="dbp-gauge__fill" strokeDasharray={`${filled} ${len}`} />
        ) : null}
      </svg>
      <figcaption className="dbp-gauge__value">
        {percent === null ? 'No data' : `${percent}%`}
      </figcaption>
    </figure>
  );
}

/** Donut with a legend that carries each slice's count, so colour is never the only signal. */
export function Donut({ slices, centre }: { slices: Slice[]; centre: ReactNode }) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="dbp-donut">
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}
      >
        <circle cx="50" cy="50" r={r} className="dbp-donut__empty" />
        {total > 0
          ? slices
              .filter((s) => s.value > 0)
              .map((s) => {
                const len = (s.value / total) * c;
                const el = (
                  <circle
                    key={s.key}
                    cx="50"
                    cy="50"
                    r={r}
                    className="dbp-donut__slice"
                    stroke={s.color}
                    strokeDasharray={`${len} ${c - len}`}
                    strokeDashoffset={-offset}
                  />
                );
                offset += len;
                return el;
              })
          : null}
        <text x="50" y="54" textAnchor="middle" className="dbp-donut__centre">
          {centre}
        </text>
      </svg>
      <ul className="dbp-legend">
        {slices.map((s) => (
          <li key={s.key}>
            <span className="dbp-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface TrendPoint {
  label: string;
  value: number | null;
}

/** Line of whole percents over time. Gaps (null) break the line rather than drawing as zero. */
export function TrendLine({ points }: { points: TrendPoint[] }) {
  const w = 600;
  const h = 200;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const x = (i: number) =>
    pad.l + (points.length <= 1 ? 0 : (i * (w - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + ((100 - v) * (h - pad.t - pad.b)) / 100;
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.value === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'} ${x(i)} ${y(p.value)} `;
    pen = true;
  });
  const summary = points
    .filter((p) => p.value !== null)
    .map((p) => `${p.label} ${p.value}%`)
    .join(', ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="dbp-trend"
      role="img"
      aria-label={`Pass rate by month: ${summary || 'no data'}`}
    >
      {[0, 50, 100].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={w - pad.r} y1={y(g)} y2={y(g)} className="dbp-trend__grid" />
          <text x={pad.l - 6} y={y(g) + 4} textAnchor="end" className="dbp-trend__tick">
            {g}%
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        i % 2 === 0 || points.length < 7 ? (
          <text key={p.label} x={x(i)} y={h - 8} textAnchor="middle" className="dbp-trend__tick">
            {p.label}
          </text>
        ) : null,
      )}
      <path d={d} className="dbp-trend__line" />
      {points.map((p, i) =>
        p.value === null ? null : (
          <circle key={p.label} cx={x(i)} cy={y(p.value)} r="3.5" className="dbp-trend__dot" />
        ),
      )}
    </svg>
  );
}

/** Horizontal bars with the count printed at the end of each. */
export function Bars({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="dbp-bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="dbp-bars__label">{r.label}</span>
          <span className="dbp-bars__track" aria-hidden="true">
            <span className="dbp-bars__fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <strong>{r.value}</strong>
        </li>
      ))}
    </ul>
  );
}
