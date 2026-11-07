import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import type { LinkComponent } from './Nova';

/** Categorical colours, in order. Every slice also has its label and figure in the legend, so colour never carries meaning alone. */
const SLICE_COLOURS = [
  'var(--c-action-primary)',
  'var(--c-status-info)',
  'var(--c-status-success)',
  'var(--c-status-warning)',
  'var(--c-ai)',
  'var(--c-status-neutral)',
  'var(--c-accent-hivis)',
];

export interface DonutSlice {
  label: string;
  value: number;
}

const R = 42;
const C = 2 * Math.PI * R;

/** Share of a total as a ring, with the total in the middle and a legend that lists every slice with its figure. */
export function DonutChart({
  slices,
  centreLabel,
  ariaLabel,
}: {
  slices: readonly DonutSlice[];
  centreLabel: string;
  ariaLabel: string;
}) {
  const shown = slices.filter((s) => s.value > 0);
  const total = shown.reduce((n, s) => n + s.value, 0);
  let offset = 0;
  return (
    <div className="ac-donut">
      <svg viewBox="0 0 100 100" className="ac-donut__ring" role="img" aria-label={ariaLabel}>
        <circle cx="50" cy="50" r={R} className="ac-donut__track" />
        {shown.map((s, i) => {
          const len = (s.value / total) * C;
          const el = (
            <circle
              key={s.label}
              cx="50"
              cy="50"
              r={R}
              className="ac-donut__slice"
              stroke={SLICE_COLOURS[i % SLICE_COLOURS.length]}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += len;
          return el;
        })}
        <text x="50" y="49" textAnchor="middle" className="ac-donut__total">
          {total}
        </text>
        <text x="50" y="61" textAnchor="middle" className="ac-donut__caption">
          {centreLabel}
        </text>
      </svg>
      <ul className="ac-legend">
        {shown.map((s, i) => (
          <li key={s.label} className="ac-legend__item">
            <span
              className="ac-legend__swatch"
              style={{ background: SLICE_COLOURS[i % SLICE_COLOURS.length] }}
              aria-hidden="true"
            />
            <span className="ac-legend__label">{s.label}</span>
            <span className="ac-legend__value">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface BarSeries {
  key: string;
  label: string;
}

export interface BarGroup {
  id: string;
  label: ReactNode;
  /** One value per series key; missing keys draw nothing. */
  values: Record<string, number>;
  /** Text read out for each value, e.g. "$1.2m". */
  formatted: Record<string, string>;
}

/** Horizontal bars, one group per row with one bar per series, all on one scale so rows compare. */
export function GroupedBars({
  series,
  groups,
  ariaLabel,
}: {
  series: readonly BarSeries[];
  groups: readonly BarGroup[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0)));
  return (
    <div role="group" aria-label={ariaLabel} className="ac-bars">
      <ul className="ac-legend ac-legend--row">
        {series.map((s, i) => (
          <li key={s.key} className="ac-legend__item">
            <span
              className="ac-legend__swatch"
              style={{ background: SLICE_COLOURS[i % SLICE_COLOURS.length] }}
              aria-hidden="true"
            />
            <span className="ac-legend__label">{s.label}</span>
          </li>
        ))}
      </ul>
      {groups.map((g) => (
        <div key={g.id} className="ac-bars__group">
          <div className="ac-bars__label">{g.label}</div>
          <div className="ac-bars__rows">
            {series.map((s, i) => {
              const v = Math.max(0, g.values[s.key] ?? 0);
              return (
                <div key={s.key} className="ac-bars__row">
                  <div className="ac-bars__track" aria-hidden="true">
                    <div
                      className="ac-bars__bar"
                      style={{
                        width: `${(v / max) * 100}%`,
                        background: SLICE_COLOURS[i % SLICE_COLOURS.length],
                      }}
                    />
                  </div>
                  <span className="ac-bars__value">
                    <span className="ac-visually-hidden">{s.label}: </span>
                    {g.formatted[s.key] ?? '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface MapPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  href: string;
}

// Mainland Australia and Tasmania, coarse outline as [lng, lat]. Drawn without map tiles, so no third party sees where sites are.
const OUTLINES: readonly (readonly [number, number][])[] = [
  [
    [113.2, -22.0],
    [114.1, -21.8],
    [114.9, -21.7],
    [116.7, -20.6],
    [118.8, -20.3],
    [121.0, -19.6],
    [122.2, -18.0],
    [123.6, -17.2],
    [124.9, -15.8],
    [126.9, -13.9],
    [129.0, -14.9],
    [129.7, -13.2],
    [131.0, -12.2],
    [132.6, -11.5],
    [135.0, -12.3],
    [136.7, -12.1],
    [136.0, -13.9],
    [135.4, -14.8],
    [137.8, -15.9],
    [139.5, -17.4],
    [141.0, -16.6],
    [141.6, -13.0],
    [142.5, -10.7],
    [143.6, -14.3],
    [144.4, -14.2],
    [145.3, -15.0],
    [146.2, -17.0],
    [146.3, -19.0],
    [148.8, -20.4],
    [150.8, -22.5],
    [152.5, -24.6],
    [153.2, -26.0],
    [153.6, -28.2],
    [153.0, -31.0],
    [152.2, -32.9],
    [150.7, -35.2],
    [150.0, -37.4],
    [148.2, -37.8],
    [146.3, -39.1],
    [145.0, -38.4],
    [143.5, -38.8],
    [141.6, -38.4],
    [140.0, -37.3],
    [139.6, -36.0],
    [138.3, -35.6],
    [137.9, -33.0],
    [137.7, -35.3],
    [135.9, -34.8],
    [134.2, -32.9],
    [131.2, -31.5],
    [129.0, -31.7],
    [126.0, -32.3],
    [123.6, -33.9],
    [121.0, -33.8],
    [118.0, -35.0],
    [115.6, -34.4],
    [115.0, -33.6],
    [115.7, -31.5],
    [114.9, -29.0],
    [113.8, -26.4],
    [113.4, -24.0],
  ],
  [
    [144.7, -40.7],
    [146.5, -40.9],
    [148.3, -40.9],
    [148.3, -42.2],
    [147.9, -43.2],
    [146.9, -43.6],
    [145.9, -43.3],
    [145.3, -42.2],
  ],
];
const BOUNDS = { minLng: 112, maxLng: 155, minLat: -44.5, maxLat: -9.5 };
const W = 430;
const H = 350;
const x = (lng: number) => ((lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * W;
const y = (lat: number) => ((BOUNDS.maxLat - lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * H;

/** Where the projects are, as pins on an outline of Australia. Pins outside it are counted underneath rather than drawn. */
export function SiteMap({
  points,
  linkAs,
  ariaLabel,
}: {
  points: readonly MapPoint[];
  linkAs?: LinkComponent;
  ariaLabel: string;
}) {
  const inside = points.filter(
    (p) =>
      p.lng >= BOUNDS.minLng &&
      p.lng <= BOUNDS.maxLng &&
      p.lat >= BOUNDS.minLat &&
      p.lat <= BOUNDS.maxLat,
  );
  const Link: LinkComponent =
    linkAs ??
    (({ href, className, children }) => (
      <a href={href} className={className}>
        {children}
      </a>
    ));
  return (
    <div className="ac-sitemap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ac-sitemap__svg" role="img" aria-label={ariaLabel}>
        {OUTLINES.map((ring, i) => (
          <polygon
            key={i}
            className="ac-sitemap__land"
            points={ring.map(([lng, lat]) => `${x(lng).toFixed(1)},${y(lat).toFixed(1)}`).join(' ')}
          />
        ))}
        {inside.map((p) => (
          <g
            key={p.id}
            className="ac-sitemap__pin"
            transform={`translate(${x(p.lng)} ${y(p.lat)})`}
          >
            <title>{p.name}</title>
            <circle r="10" className="ac-sitemap__dot" />
            <circle r="4" className="ac-sitemap__core" />
          </g>
        ))}
      </svg>
      <ul className={cx('ac-legend', 'ac-sitemap__list')}>
        {points.map((p) => (
          <li key={p.id} className="ac-legend__item">
            <Link href={p.href} className="link ac-legend__label">
              {p.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface TonedBar {
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}

/** One bar per category on a shared scale, coloured by tone, with the count at the end of each bar. */
export function ToneBars({ bars, ariaLabel }: { bars: readonly TonedBar[]; ariaLabel: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <ul className="ac-tonebars" aria-label={ariaLabel}>
      {bars.map((b) => (
        <li key={b.label} className="ac-tonebars__item">
          <span className="ac-tonebars__label">{b.label}</span>
          <span className="ac-bars__track" aria-hidden="true">
            <span
              className="ac-bars__bar ac-tonebars__bar"
              style={{
                width: `${(b.value / max) * 100}%`,
                background: `var(--c-status-${b.tone})`,
              }}
            />
          </span>
          <span className="ac-tonebars__value">{b.value}</span>
        </li>
      ))}
    </ul>
  );
}
