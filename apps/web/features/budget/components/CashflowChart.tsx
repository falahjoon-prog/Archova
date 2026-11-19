'use client';

import { aud } from '../lib/money';
import { cents, chartScale, shortMonth, type CashMonth } from '../lib/cashflow';

const H = 220;
const PAD_T = 12;
const PAD_B = 28;
const PAD_X = 8;
const SLOT = 40;

/**
 * Cash in and cash out per month as bars, with the running position as a line. Forecast months are drawn lighter and
 * hatched so they read apart from actuals without relying on colour. The figures sit in the table beside it, so the
 * chart never carries a number alone.
 */
export function CashflowChart({ months }: { months: readonly CashMonth[] }) {
  if (months.length === 0) return null;
  const { hi, lo, cum } = chartScale(months);
  const W = Math.max(720, months.length * SLOT + PAD_X * 2);
  const plot = H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + ((hi - v) * plot) / Math.max(hi - lo, 1);
  const x = (i: number) => PAD_X + i * SLOT + SLOT / 2;
  const zero = y(0);
  const bw = SLOT / 2 - 3;
  const every = months.length > 12 ? 3 : months.length > 6 ? 2 : 1;
  const line = months.map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(cum[i] ?? 0)}`).join(' ');
  const last = months[months.length - 1]!;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Cash in, cash out and running position by month, ${shortMonth(months[0]!.month)} to ${shortMonth(last.month)}. Ends at ${aud(last.cumulative)}.`}
        style={{ width: '100%', minWidth: 520, height: 'auto' }}
      >
        <defs>
          <pattern
            id="cf-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="var(--c-surface)" />
            <rect width="2.5" height="6" fill="currentColor" />
          </pattern>
        </defs>
        <line x1={0} x2={W} y1={zero} y2={zero} stroke="var(--c-border-control)" strokeWidth="1" />
        {months.map((m, i) => {
          const forecast = m.kind === 'forecast';
          const inH = (cents(m.cashIn) * plot) / Math.max(hi - lo, 1);
          const outH = (cents(m.cashOut) * plot) / Math.max(hi - lo, 1);
          return (
            <g key={m.month}>
              <rect
                x={x(i) - bw - 1}
                y={zero - inH}
                width={bw}
                height={Math.max(inH, 0)}
                fill={forecast ? 'url(#cf-hatch)' : 'currentColor'}
                color="var(--c-action-primary)"
                stroke="var(--c-action-primary)"
                strokeWidth={forecast ? 1 : 0}
              />
              <rect
                x={x(i) + 1}
                y={zero - outH}
                width={bw}
                height={Math.max(outH, 0)}
                fill={forecast ? 'url(#cf-hatch)' : 'currentColor'}
                color="var(--c-status-warning)"
                stroke="var(--c-status-warning)"
                strokeWidth={forecast ? 1 : 0}
              />
              {i % every === 0 ? (
                <text
                  x={x(i)}
                  y={H - 8}
                  fontSize="10"
                  textAnchor="middle"
                  fill="var(--c-text-secondary)"
                >
                  {shortMonth(m.month)}
                </text>
              ) : null}
            </g>
          );
        })}
        <path d={line} fill="none" stroke="var(--c-text)" strokeWidth="2" />
        {months.map((m, i) => (
          <circle
            key={m.month}
            cx={x(i)}
            cy={y(cum[i] ?? 0)}
            r={cents(m.cumulative) < 0 ? 3.5 : 2.5}
            fill="var(--c-text)"
          />
        ))}
      </svg>
    </div>
  );
}
