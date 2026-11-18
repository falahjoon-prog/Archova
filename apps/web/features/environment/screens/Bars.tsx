'use client';

/** A small column chart: one bar per period, with an optional dashed target line. Values are shown as text too. */
export function MonthBars({
  label,
  items,
  target,
  max,
  format,
}: {
  label: string;
  items: { key: string; label: string; value: number | null }[];
  /** Same units as the values. */
  target?: number;
  /** Top of the scale; the largest value when left out. */
  max?: number;
  format: (v: number) => string;
}) {
  const w = 300;
  const h = 96;
  const top = max ?? Math.max(1, ...items.map((i) => i.value ?? 0), target ?? 0);
  const bar = w / items.length;
  const y = (v: number) => h - (v / top) * (h - 4);
  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${w} ${h + 18}`}
        role="img"
        aria-label={label}
        style={{ width: '100%', maxWidth: 420 }}
      >
        {items.map((it, i) => (
          <g key={it.key}>
            {it.value !== null && it.value > 0 ? (
              <rect
                x={i * bar + bar * 0.2}
                y={y(it.value)}
                width={bar * 0.6}
                height={h - y(it.value)}
                rx="2"
                fill="currentColor"
                opacity="0.75"
              />
            ) : null}
            <text
              x={i * bar + bar / 2}
              y={h + 13}
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {it.label}
            </text>
          </g>
        ))}
        {target !== undefined ? (
          <line
            x1="0"
            x2={w}
            y1={y(target)}
            y2={y(target)}
            stroke="currentColor"
            strokeDasharray="4 3"
            opacity="0.5"
          />
        ) : null}
      </svg>
      <figcaption className="u-caption">
        {items
          .map((it) => `${it.label} ${it.value === null ? 'no data' : format(it.value)}`)
          .join(' · ')}
      </figcaption>
    </figure>
  );
}

export const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-AU', {
    month: 'short',
    timeZone: 'UTC',
  });
